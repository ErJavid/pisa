import { ethers } from "ethers";
import { MultiResponder } from "./multiResponder";
import { ConfirmationObserver, BlockTimeoutDetector } from "../blockMonitor";
import {
    DoublingGasPolicy,
    EthereumDedicatedResponder,
    EthereumTransactionMiner,
    ResponseFlow,
    ResponderEvent,
    IGasPolicy
} from "./responder";
import { ArgumentError, IEthereumAppointment } from "../dataEntities";
import logger from "../logger";
import { plural } from "../utils";

/**
 * Responsible for handling the business logic of the Responders.
 */
export class EthereumResponderManager {
    private provider: ethers.providers.Provider;
    private gasPolicy: IGasPolicy;

    constructor(
        private readonly dedicated: boolean,
        private readonly signer: ethers.Signer,
        private readonly blockTimeoutDetector: BlockTimeoutDetector,
        private readonly confirmationObserver: ConfirmationObserver,
        private readonly multiResponder: MultiResponder
    ) {
        if (!signer.provider) throw new ArgumentError("The given signer is not connected to a provider");
        this.provider = signer.provider;
        this.gasPolicy = new DoublingGasPolicy(this.provider);
    }

    public async respond(appointment: IEthereumAppointment) {
        if (this.dedicated) await this.respondDedicated(appointment);
        else await this.respondMulti(appointment);
    }

    private async respondMulti(appointment: IEthereumAppointment) {
        const ethereumResponseData = appointment.getResponseData();
        await this.multiResponder.startResponse(appointment.id, ethereumResponseData);
    }

    private async respondDedicated(appointment: IEthereumAppointment) {
        const ethereumResponseData = appointment.getResponseData();

        const transactionMiner = new EthereumTransactionMiner(
            this.signer,
            this.blockTimeoutDetector,
            this.confirmationObserver,
            40,
            10
        );

        const responder = new EthereumDedicatedResponder(this.signer, this.gasPolicy, 40, 10, transactionMiner);
        await responder
            .on(ResponderEvent.ResponseSent, (responseFlow: ResponseFlow, attemptNumber: number) => {
                logger.info(
                    `Successfully responded to appointment ${
                        appointment.id
                    } on attempt #${attemptNumber}. Waiting for enough confirmations.`
                );
            })
            .on(ResponderEvent.ResponseConfirmed, (responseFlow: ResponseFlow, attemptNumber: number) => {
                logger.info(
                    `Successfully responded to appointment ${appointment.id} after ${attemptNumber} ${plural(
                        attemptNumber,
                        "attempt"
                    )}.`
                );
            })
            .on(ResponderEvent.AttemptFailed, (responseFlow: ResponseFlow, doh: Error, attemptNumber: number) => {
                logger.error(
                    `Failed to respond to appointment ${appointment.id}; ${attemptNumber} ${plural(
                        attemptNumber,
                        "attempt"
                    )}.`
                );
                logger.error(doh);
            })
            .on(ResponderEvent.ResponseFailed, (responseFlow: ResponseFlow, attempts: number) => {
                logger.error(
                    `Failed to respond to ${appointment.id}, after ${attempts} ${plural(
                        attempts,
                        "attempt"
                    )}. Giving up.`
                );

                // TODO: this is serious and should be escalated.
            })
            .startResponse(appointment.id, ethereumResponseData);
    }
}
