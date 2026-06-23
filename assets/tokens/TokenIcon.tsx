/**
 * TokenIcon — pixel-art (pure SVG) token coins for the Stellar app.
 *
 * Branded coin set (style "A"): the real token mark on a shaded pixel coin.
 * Files: assets/tokens/<sym>-coin{32,24}.svg  (32 = sweet spot, 24 = chunkier)
 * Set: usdc, eurc, usdt, xlm, dai  (add more via assets/tokens/generate.py)
 *
 * Usage:
 *   <TokenIcon symbol="USDC" />
 *   <TokenIcon symbol="xlm" size={24} grid={24} />
 *
 * Serve the SVGs at `base` (default "/assets/tokens"). `image-rendering:pixelated`
 * keeps them crisp at any size, matching the app's pixel theme.
 */
import React from "react";

export const TOKENS = ["usdc", "eurc", "usdt", "xlm", "dai"] as const;
export type TokenSymbol = (typeof TOKENS)[number] | (string & {});

export interface TokenIconProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> {
  symbol: TokenSymbol;
  /** rendered px size (square). default 32 */
  size?: number;
  /** source grid resolution. default 32 */
  grid?: 24 | 32;
  /** path the SVGs are served from. default "/assets/tokens" */
  base?: string;
}

export function TokenIcon({
  symbol,
  size = 32,
  grid = 32,
  base = "/assets/tokens",
  style,
  ...rest
}: TokenIconProps) {
  const sym = String(symbol).toLowerCase();
  return (
    <img
      src={`${base}/${sym}-coin${grid}.svg`}
      width={size}
      height={size}
      alt={String(symbol).toUpperCase()}
      style={{
        imageRendering: "pixelated",
        display: "inline-block",
        verticalAlign: "middle",
        ...style,
      }}
      {...rest}
    />
  );
}

export default TokenIcon;
