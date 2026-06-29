export type CoordinatorCancelAuth = {
  timestamp: string;
  signature: string;
};

export function coordinatorCancelPayload({
  owner,
  note,
  auth,
  onchainCancelled = false,
}: {
  owner: string;
  note: string;
  auth?: CoordinatorCancelAuth;
  onchainCancelled?: boolean;
}) {
  if (onchainCancelled) {
    return { owner, note, onchain_cancelled: true };
  }
  if (!auth) throw new Error("wallet cancel authorization is required");
  return { owner, note, timestamp: auth.timestamp, signature: auth.signature };
}
