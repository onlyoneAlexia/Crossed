export type CoordinatorHealth = {
  ok?: boolean;
  dp_order_v2?: boolean;
  dp_contract?: string;
  contract?: string;
  [key: string]: unknown;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const DEFAULT_COORDINATOR_URL = "http://127.0.0.1:8790";

export async function assertCoordinatorReady({
  coordinatorUrl = DEFAULT_COORDINATOR_URL,
  coordinatorApiToken = "",
  expectedDpContractId = "",
  requireDpOrderV2 = false,
  fetchImpl = fetch,
}: {
  coordinatorUrl?: string;
  coordinatorApiToken?: string;
  expectedDpContractId?: string;
  requireDpOrderV2?: boolean;
  fetchImpl?: FetchLike;
} = {}): Promise<CoordinatorHealth> {
  let response: Response;
  try {
    response = await fetchImpl(`${coordinatorUrl}/health`);
  } catch (error) {
    throw new Error(
      `Coordinator is not reachable at ${coordinatorUrl}. Start the coordinator before placing a sealed order; no funds were moved.`,
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new Error(`Coordinator health check failed (${response.status}). No funds were moved.`);
  }

  let health: CoordinatorHealth;
  try {
    health = await response.json();
  } catch (error) {
    throw new Error("Coordinator health check returned invalid JSON. No funds were moved.", { cause: error });
  }

  if (health.ok !== true) {
    throw new Error("Coordinator is not healthy. No funds were moved.");
  }
  if (expectedDpContractId && health.dp_contract && health.dp_contract !== expectedDpContractId) {
    throw new Error("Coordinator is connected to a different dark-pool contract. No funds were moved.");
  }
  if (requireDpOrderV2 && health.dp_order_v2 !== true) {
    throw new Error("Coordinator is not running with DP_ORDER_V2=1. No funds were moved.");
  }

  const authHeaders: HeadersInit = coordinatorApiToken
    ? { authorization: `Bearer ${coordinatorApiToken}` }
    : {};
  const authResponse = await fetchImpl(`${coordinatorUrl}/auth/check`, {
    headers: authHeaders,
  });
  if (!authResponse.ok) {
    throw new Error(`Coordinator API auth check failed (${authResponse.status}). No funds were moved.`);
  }

  return health;
}
