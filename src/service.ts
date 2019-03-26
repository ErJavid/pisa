import express, { Response } from "express";
import httpContext from "express-http-context";
import logger from "./logger";
import { parseAppointment, PublicValidationError, parseRaidenAppointment } from "./dataEntities/appointment";
import { KitsuneInspector } from "./inspector/kitsune";
import { RaidenInspector } from "./inspector/raiden";
import { PublicInspectionError } from "./inspector/inspector";
import { Watcher, RaidenWatcher, KitsuneWatcher } from "./watcher";
// PISA: this isn working properly, it seems that watchers are sharing the last set value...
import { setRequestId } from "./customExpressHttpContext";
import { Server } from "http";
import { inspect } from "util";
import { ethers } from "ethers";

/**
 * Hosts a PISA service at the endpoint.
 */
export class PisaService {
    private readonly server: Server;

    //PISA: arg documentation
    constructor(hostname: string, port: number, provider: ethers.providers.Provider, wallet: ethers.Wallet) {
        const app = express();
        // accept json request bodies
        app.use(express.json());
        // use http context middleware to create a request id available on all requests
        app.use(httpContext.middleware);
        app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
            setRequestId();
            next();
        });

        const kitsuneInspector = new KitsuneInspector(10, provider);
        const kitsuneWatcher = new KitsuneWatcher(provider, wallet);
        app.post("/appointment", this.appointment(kitsuneInspector, kitsuneWatcher));

        // PISA: currently set to 4 for demo purposes - this should be a commandline/config arg
        const raidenInspector = new RaidenInspector(4, provider);
        const raidenWatcher = new RaidenWatcher(provider, wallet);
        app.post("/raidenAppointment", this.raidenAppointment(raidenInspector, raidenWatcher));

        const service = app.listen(port, hostname);
        logger.info(`PISA listening on: ${hostname}:${port}.`);
        this.server = service;
    }

    private appointment(inspector: KitsuneInspector, watcher: Watcher) {
        return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
            try {
                const appointmentRequest = parseAppointment(req.body);
                // inspect this appointment
                const appointment = await inspector.inspect(appointmentRequest);

                // start watching it if it passed inspection
                await watcher.watch(appointment);

                // return the appointment
                res.status(200);
                res.send(appointment);
            } catch (doh) {
                if (doh instanceof PublicInspectionError) this.logAndSend(400, doh.message, doh, res);
                else if (doh instanceof PublicValidationError) this.logAndSend(400, doh.message, doh, res);
                else if (doh instanceof Error) this.logAndSend(500, "Internal server error.", doh, res);
                else {
                    logger.error("Error: 500. " + inspect(doh));
                    res.status(500);
                    res.send("Internal server error.");
                }
            }
        };
    }

    private raidenAppointment(inspector: RaidenInspector, watcher: RaidenWatcher) {
        return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
            try {
                const appointmentRequest = parseRaidenAppointment(req.body);
                // inspect this appointment
                const appointment = await inspector.inspect(appointmentRequest);

                // start watching it if it passed inspection
                watcher.watch(appointment);

                // return the appointment
                res.status(200);
                res.send(appointment);
            } catch (doh) {
                if (doh instanceof PublicInspectionError) this.logAndSend(400, doh.message, doh, res);
                else if (doh instanceof PublicValidationError) this.logAndSend(400, doh.message, doh, res);
                else if (doh instanceof Error) this.logAndSend(500, "Internal server error.", doh, res);
                else {
                    logger.error("Error: 500. " + inspect(doh));
                    res.status(500);
                    res.send("Internal server error.");
                }
            }
        };
    }

    private logAndSend(code: number, responseMessage: string, error: Error, res: Response) {
        logger.error(`HTTP Status: ${code}.`);
        logger.error(error.stack);
        res.status(code);
        res.send(responseMessage);
    }

    private closed = false;
    public stop() {
        if (!this.closed) {
            this.server.close(logger.info(`PISA shutdown.`));
            this.closed = true;
        }
    }
}
