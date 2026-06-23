#!/usr/bin/env node
// Emit `stellar contract invoke` JSON args (hex) for the verifier, from snarkjs output.
const fs = require("fs");
const path = require("path");
const dir = process.argv[2] || "circuits/build";
const outDir = process.argv[3] || "/tmp";

const vk = JSON.parse(fs.readFileSync(path.join(dir, "verification_key.json")));
const proof = JSON.parse(fs.readFileSync(path.join(dir, "proof.json")));
const pub = JSON.parse(fs.readFileSync(path.join(dir, "public.json")));

const be32 = (dec) => BigInt(dec).toString(16).padStart(64, "0");
const g1 = (p) => be32(p[0]) + be32(p[1]);                                   // 64B
const g2 = (p) => be32(p[0][1]) + be32(p[0][0]) + be32(p[1][1]) + be32(p[1][0]); // c1,c0
const fr = (s) => be32(s);

const vkArg = {
  alpha1: g1(vk.vk_alpha_1),
  beta2: g2(vk.vk_beta_2),
  gamma2: g2(vk.vk_gamma_2),
  delta2: g2(vk.vk_delta_2),
  ic: vk.IC.map(g1),
};
const proofArg = { a: g1(proof.pi_a), b: g2(proof.pi_b), c: g1(proof.pi_c) };
const pubArg = pub.map(fr);

fs.writeFileSync(path.join(outDir, "vk.json"), JSON.stringify(vkArg));
fs.writeFileSync(path.join(outDir, "proof.json"), JSON.stringify(proofArg));
fs.writeFileSync(path.join(outDir, "pub.json"), JSON.stringify(pubArg));
console.log("wrote vk.json, proof.json, pub.json to", outDir);
