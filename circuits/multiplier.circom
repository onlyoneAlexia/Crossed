pragma circom 2.0.0;

// Minimal spike circuit: prove knowledge of two private factors a, b
// whose product equals the public output c. Exercises 1 public signal
// (so the on-chain verifier's IC / MSM path is tested).
template Multiplier() {
    signal input a;       // private
    signal input b;       // private
    signal output c;      // public (outputs are public by default)
    c <== a * b;
}

component main = Multiplier();
