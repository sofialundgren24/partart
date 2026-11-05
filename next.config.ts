import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["manifold-3d", "@prisma/client", "@gltf-transform/core"],
};

export default nextConfig;
