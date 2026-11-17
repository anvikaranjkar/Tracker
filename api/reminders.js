import { productionDb } from '../server/db.mjs';
import { reminderHandler } from '../server/push.mjs';

export default { fetch: reminderHandler(await productionDb()) };
