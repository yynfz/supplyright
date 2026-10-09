import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Slim, self-contained server output for the Docker image (see ../Dockerfile).
  output: "standalone",
  webpack: (config) => {
    // Optional dependencies of wallet SDKs pulled in transitively by RainbowKit/wagmi connectors.
    // They are only needed by features SupplyRight does not use (Base Account payments, React Native storage,
    // pretty logging), so they are stubbed out instead of installed.
    config.resolve.alias = {
      ...config.resolve.alias,
      // Coinbase CDP SDK is only used by the Base Account "payment/charge" API (x402 + Solana deps).
      "@coinbase/cdp-sdk": false,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };
    return config;
  },
};

export default nextConfig;
