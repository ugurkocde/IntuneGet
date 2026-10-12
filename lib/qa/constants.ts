export const QA_LIVE_FRAME_MAX_AGE_MS = 15_000;

// A customer waiting on their own deployment always goes first. auto_update
// and managed demand share the urgent band directly below it, in FIFO order
// by age; targeted/operator retests and background backfill sit lower still.
export const QA_PRIORITY_CUSTOMER = 2100;
export const QA_PRIORITY_DEMAND = 2000;
