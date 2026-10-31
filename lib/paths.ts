import path from "node:path";

/**
 * Where runtime and seed data live. `DATA_DIR` lets the offline tests run against a throwaway
 * folder so they never touch the demo's saved tasks, proposals or learned decisions.
 */
export const dataPath = (...parts: string[]) => path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), ...parts);
