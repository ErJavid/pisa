import { LevelUp } from "levelup";
import EncodingDown from "encoding-down";
const sub = require("subleveldown");
import uuid = require("uuid/v4");
import { ComponentAction } from "./component";
import { StartStopService } from "../dataEntities";


export interface ActionAndId {
    id: string;
    action: ComponentAction;
}

export class ActionStore extends StartStopService {
    private readonly subDb: LevelUp<EncodingDown<string, any>>;
    private actions: Map<string, Set<ActionAndId>> = new Map();

    constructor(db: LevelUp<EncodingDown<string, any>>) {
        super("action-store");
        this.subDb = sub(db, `action-store`, { valueEncoding: "json" });
    }

    protected async startInternal() {
        // load existing actions from the db
        for await (const record of this.subDb.createReadStream()) {
            const { key, value } = (record as any) as { key: string; value: ComponentAction };

            const i = key.indexOf(":");
            const componentName = key.substring(0, i);
            const actionId = key.substring(i + 1);

            const actionWithId = { id: actionId, action: value };

            const componentActions = this.actions.get(componentName);
            if (componentActions) componentActions.add(actionWithId);
            else this.actions.set(componentName, new Set([actionWithId]));
        }
    }
    protected async stopInternal() {}

    public getActions(componentName: string) {
        return this.actions.get(componentName) || new Set();
    }

    public async storeActions(componentName: string, actions: ComponentAction[]) {
        // we forge unique ids for actions to uniquely distinguish them in the db
        const actionsWithId = actions.map(a => ({ id: uuid(), action: a }));

        const componentSet = this.actions.get(componentName);
        if (componentSet) actionsWithId.forEach(a => componentSet.add(a));
        else this.actions.set(componentName, new Set(actionsWithId));

        let batch = this.subDb.batch();
        actionsWithId.forEach(actionWithId => {
            batch = batch.put(componentName + ":" + actionWithId.id, actionWithId.action);
        });
        await batch.write();
    }

    public async removeAction(componentName: string, actionAndId: ActionAndId) {
        const actions = this.actions.get(componentName);
        if (!actions) return;
        else actions.delete(actionAndId);
        await this.subDb.del(componentName + ":" + actionAndId.id);
    }
}
