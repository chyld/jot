// A backup or restore problem the user can understand and act on. The message is shown
// as it is; `code` lets the browser tell a temporary refusal from a permanent one.
export class BackupError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code?: 'busy' | 'restore-in-progress',
  ) {
    super(message);
  }
}

export const BUSY_MESSAGE = 'Another backup or restore is running. Try again when it has finished.';
export const RESTORING_MESSAGE = 'A restore of your data is in progress. Try again when it has finished.';
