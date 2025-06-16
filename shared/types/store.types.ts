// --- Storage and Persistence Types ---

/** Payload for saving a temporary file. */
export interface SaveTempFilePayload {
  fileName: string;
  data: Uint8Array;
}

/** Payload for setting a value in the persistent store. */
export interface SetStorePayload {
  key: string;
  value: string;
}

/** Payload for removing a value from the persistent store. */
export interface RemoveStorePayload {
  key: string;
}

/** Payload for getting a value from the persistent store. */
export interface GetStorePayload {
  key: string;
}