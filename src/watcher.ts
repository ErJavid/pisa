import { IAppointment, IRaidenAppointment } from "./dataEntities/appointment";
import { ethers } from "ethers";
import { KitsuneTools } from "./kitsuneTools";
import logger from "./logger";
import { inspect } from "util";
import RaidenContracts from "./raiden_data.json";
const tokenNetworkAbi = RaidenContracts.contracts.TokenNetwork.abi;

/**
 * A watcher is responsible for watching for, and responding to, events emitted on-chain.
 */
export class Watcher {
    constructor(
        public readonly provider: ethers.providers.Provider,
        public readonly signer: ethers.Signer,
        private readonly channelAbi: any,
        private readonly eventName: string,
        private readonly eventCallback: (
            contract: ethers.Contract,
            appointment: IAppointment,
            ...args: any[]
        ) => Promise<any>
    ) {}

    /**
     * Watch for an event specified by the appointment, and respond if it the event is raised.
     * @param appointment Contains information about where to watch for events, and what information to suppli as part of a response
     */
    async watch(appointment: IAppointment) {
        // PISA: safety check the appointment - check the inspection time?

        // create a contract
        logger.info(
            `Begin watching for event ${this.eventName} in contract ${appointment.stateUpdate.contractAddress}.`
        );
        logger.debug(`Watching appointment: ${appointment}.`);

        const contract = new ethers.Contract(
            appointment.stateUpdate.contractAddress,
            this.channelAbi,
            this.provider
        ).connect(this.signer);

        // watch the supplied event
        contract.on(this.eventName, async (...args: any[]) => {
            // this callback should not throw exceptions as they cannot be handled elsewhere

            // call the callback
            try {
                logger.info(
                    `Observed event ${this.eventName} in contract ${contract.address} with arguments : ${args.slice(
                        0,
                        args.length - 1
                    )}. Beginning response.`
                );
                logger.debug(`Event info ${inspect(args[1])}`);
                await this.eventCallback(contract, appointment, ...args);
            } catch (doh) {
                // an error occured whilst responding to the callback - this is serious and the problem needs to be correctly diagnosed
                logger.error(doh);
                logger.error(
                    `Error occured whilst responding to event ${this.eventName} in contract ${contract.address}.`
                );
            }

            // remove subscription - we've satisfied our appointment
            try {
                logger.info(`Reponse successful, removing listener.`);
                contract.removeAllListeners(this.eventName);
                logger.info(`Listener removed.`);
            } catch (doh) {
                logger.error(`Failed to remove listener on event ${this.eventName} in contract ${contract.address}.`);
            }
        });
    }
}

/**
 * A watcher is responsible for watching for, and responding to, events emitted on-chain.
 */
export class RaidenWatcher {
    // a list of the current appointments this watcher is watching
    // it only needs to keep the latest appointment per channel - so it replaces appointments in this list and removes listeners

    contracts: {
        [tokenNetworkIdentifier: string]: {
            contract: ethers.Contract;
            appointments: {
                [channelIdentifier: number]: { appointment: IRaidenAppointment; listener: ethers.providers.Listener };
            };
        };
    } = {};

    constructor(
        private readonly provider: ethers.providers.Provider,
        private readonly signer: ethers.Signer //private readonly channelAbi: any, // private readonly eventName: string, // private readonly eventCallback: ( //     contract: ethers.Contract, //     appointment: IAppointment, //     ...args: any[]
    ) // ) => Promise<any>
    {}

    /**
     * Watch for an event specified by the appointment, and respond if it the event is raised.
     * @param appointment Contains information about where to watch for events, and what information to suppli as part of a response
     */
    watch(appointment: IRaidenAppointment) {
        const eventName = (channelIdentifier: number, closingParticipant: string, nonce: number) => {
            return `ChannelClosed - ${channelIdentifier} - ${closingParticipant} - ${nonce}`;
        };

        // PISA: safety check the appointment - check the inspection time?

        // create a contract
        logger.info(
            `Begin watching for event ${eventName(
                appointment.stateUpdate.channel_identifier,
                appointment.stateUpdate.closing_participant,
                appointment.stateUpdate.nonce
            )} in contract ${appointment.stateUpdate.token_network_identifier}.`
        );

        logger.debug(`Watching appointment: ${appointment}.`);
        let tokenNetwork = this.contracts[appointment.stateUpdate.token_network_identifier];
        let contract;
        if(tokenNetwork) {
            contract = tokenNetwork.contract
        }
        else {
            contract = new ethers.Contract(
                appointment.stateUpdate.token_network_identifier,
                tokenNetworkAbi,
                this.provider
            ).connect(this.signer);
            
            // set the token network at this stage
            tokenNetwork = this.contracts[appointment.stateUpdate.token_network_identifier] = { contract: contract, appointments: {} };
        }

        const filter = contract.filters.ChannelClosed(
            appointment.stateUpdate.channel_identifier,
            appointment.stateUpdate.closing_participant,
            null
        );

        // we only want one watcher per channel - for the highest nonce
        // so we replace the watcher if we witness a higher nonce
        // PISA: race conditions abound here  - this isn't safe. But it'll do for the demo purposes
        const currentAppointment = tokenNetwork.appointments[appointment.stateUpdate.channel_identifier];
        if (currentAppointment) {
            // should check the nonces here
            contract.removeListener(filter, currentAppointment.listener);
            logger.info(
                `Stopped watching nonce: ${currentAppointment.appointment.stateUpdate.nonce} on channel ${
                    currentAppointment.appointment.stateUpdate.channel_identifier
                }`
            );
        }

        const listener: ethers.providers.Listener = async (
            channelIdentifier: number,
            closingParticipant: string,
            nonce: number
        ) => {
            // this callback should not throw exceptions as they cannot be handled elsewhere

            // call the callback
            try {
                logger.info(
                    `Observed event ${eventName(channelIdentifier, closingParticipant, nonce)} in contract ${
                        contract.address
                    }. Beginning response.`
                );

                // some very basic retry behaviour
                let trying = true;
                let tries = 0;
                let tx;
                while (trying && tries < 10) {
                    try {
                        tx = await contract.updateNonClosingBalanceProof(
                            appointment.stateUpdate.channel_identifier,
                            appointment.stateUpdate.closing_participant,
                            appointment.stateUpdate.non_closing_participant,
                            appointment.stateUpdate.balance_hash,
                            appointment.stateUpdate.nonce,
                            appointment.stateUpdate.additional_hash,
                            appointment.stateUpdate.closing_signature,
                            appointment.stateUpdate.non_closing_signature
                        );
                        trying = false;
                    } catch (exe) {
                        // lets retry this hard until we can no longer
                        logger.error(`Failed to set state for contract ${contract.address}, re-tries ${tries}`);
                        tries++;
                        await wait(1000);
                    }
                }

                if (trying) throw new Error("Failed after 10 tries.");
                else {
                    logger.info(`Successful response to ${contract.address} for channel ${appointment.stateUpdate.channel_identifier} after ${tries + 1} tr${tries + 1 === 1 ? "y" : "ies"}.`);
                }
                await tx.wait();
            } catch (doh) {
                // an error occured whilst responding to the callback - this is serious and the problem needs to be correctly diagnosed
                logger.error(doh);
                logger.error(
                    `Error occured whilst responding to event ${eventName(
                        channelIdentifier,
                        closingParticipant,
                        nonce
                    )} in contract ${contract.address}.`
                );
            }
        };

        // watch the supplied event
        contract.once(filter, listener);

        // add this listener to the current appointments
        tokenNetwork.appointments[appointment.stateUpdate.channel_identifier] = {
            listener: listener,
            appointment: appointment
        };
    }
}

const wait = (timeout: number) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, timeout);
    });
};

export class KitsuneWatcher extends Watcher {
    constructor(provider: ethers.providers.Provider, signer: ethers.Signer) {
        super(provider, signer, KitsuneTools.ContractAbi, "EventDispute(uint256)", KitsuneTools.respond);
    }
}
