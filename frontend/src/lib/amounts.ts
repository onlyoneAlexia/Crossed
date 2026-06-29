export const TOKEN_SCALE = 10000000n;
export const TOKEN_DECIMALS = 7;
export const DISPLAY_DECIMALS = 4;

const TEN = 10n;

function pow10(decimals: number): bigint {
  let value = 1n;
  for (let i = 0; i < decimals; i += 1) value *= TEN;
  return value;
}

function groupInteger(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function trimFraction(value: string): string {
  return value.replace(/0+$/, "");
}

function splitAtomic(value: bigint | string): { sign: string; whole: bigint; frac: string } {
  const raw = BigInt(value);
  const sign = raw < 0n ? "-" : "";
  const absolute = raw < 0n ? -raw : raw;
  return {
    sign,
    whole: absolute / TOKEN_SCALE,
    frac: (absolute % TOKEN_SCALE).toString().padStart(TOKEN_DECIMALS, "0"),
  };
}

export function parseAtomicAmount(value: string): bigint | null {
  const raw = value.trim();
  if (raw === "") return 0n;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;

  const [wholeRaw, fractionRaw = ""] = raw.split(".");
  const fraction = (fractionRaw + "0".repeat(TOKEN_DECIMALS)).slice(0, TOKEN_DECIMALS);

  try {
    return BigInt(wholeRaw || "0") * TOKEN_SCALE + BigInt(fraction || "0");
  } catch {
    return null;
  }
}

export function atomicToDecimalString(value: bigint | string, maxDecimals = TOKEN_DECIMALS): string {
  const decimals = Math.max(0, Math.min(TOKEN_DECIMALS, maxDecimals));
  const { sign, whole, frac } = splitAtomic(value);
  const fraction = trimFraction(frac.slice(0, decimals));
  return fraction ? `${sign}${whole.toString()}.${fraction}` : `${sign}${whole.toString()}`;
}

export function formatAtomicAmount(value: bigint | string, maxDecimals = DISPLAY_DECIMALS): string {
  const raw = BigInt(value);
  const decimals = Math.max(0, Math.min(TOKEN_DECIMALS, maxDecimals));
  const minShown = pow10(TOKEN_DECIMALS - decimals);

  if (raw !== 0n && decimals > 0 && (raw < 0n ? -raw : raw) < minShown) {
    return raw < 0n ? `>-0.${"0".repeat(decimals - 1)}1` : `<0.${"0".repeat(decimals - 1)}1`;
  }

  const { sign, whole, frac } = splitAtomic(raw);
  const fraction = trimFraction(frac.slice(0, decimals));
  const integer = groupInteger(whole.toString());
  return fraction ? `${sign}${integer}.${fraction}` : `${sign}${integer}`;
}

export function formatAtomicRatio(quoteAtomic: bigint, baseAtomic: bigint, maxDecimals = DISPLAY_DECIMALS): string {
  if (quoteAtomic <= 0n || baseAtomic <= 0n) return "0";

  const decimals = Math.max(0, maxDecimals);
  const scale = pow10(decimals);
  const scaled = (quoteAtomic * scale) / baseAtomic;
  const whole = scaled / scale;
  const fraction = decimals > 0 ? trimFraction((scaled % scale).toString().padStart(decimals, "0")) : "";
  const integer = groupInteger(whole.toString());
  return fraction ? `${integer}.${fraction}` : integer;
}

export function formatDecimalAmount(value: string, maxDecimals = DISPLAY_DECIMALS): string {
  const parsed = parseAtomicAmount(value);
  return parsed === null ? "0" : formatAtomicAmount(parsed, maxDecimals);
}
