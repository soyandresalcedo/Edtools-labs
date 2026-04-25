const path = require("path");
const webpack = require("webpack");

const transformersWeb = path.resolve(
  __dirname,
  "node_modules/@huggingface/transformers/dist/transformers.web.js",
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: false,
  // kokoro: import en runtime desde /vendors-tts (ver scripts/copy-tts-assets.cjs)
  transpilePackages: ["@huggingface/transformers"],
  experimental: {
    esmExternals: "loose",
  },
  // Cache duro para los assets self-hosted de Kokoro/ORT/transformers en
  // /public/vendors-tts/. Los nombres de archivo encapsulan modelo/revision
  // (e.g. onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model_quantized.onnx), así
  // que un cambio de versión cambia la ruta y la cache no aplica al nuevo path.
  async headers() {
    return [
      {
        source: "/vendors-tts/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    config.plugins = config.plugins ?? [];
    // Kokoro pulls @huggingface/transformers; webpack often picks the "node"
    // export (transformers.node.mjs), which keeps import.meta and crashes in
    // the browser. Always substitute the browser bundle.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /transformers\.node(?:\.min)?\.(?:mjs|cjs|js)$/,
        transformersWeb,
      ),
    );

    if (!isServer) {
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /onnxruntime-web[\\/]dist[\\/]ort\.node\./,
        }),
      );
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /^onnxruntime-node$/,
        }),
      );
    }

    config.experiments = {
      ...(config.experiments ?? {}),
      asyncWebAssembly: true,
      topLevelAwait: true,
      layers: true,
    };

    config.module.rules.push({
      test: /\.m?js$/,
      resolve: { fullySpecified: false },
    });

    // Do not noParse ORT / Kokoro on the client: those bundles contain
    // `import.meta` and must be processed as modules or the browser throws
    // "Cannot use 'import.meta' outside a module".
    if (isServer) {
      config.module.noParse = [
        ...(config.module.noParse ? [].concat(config.module.noParse) : []),
        /onnxruntime-web[\\/]dist[\\/]ort\..*\.m?js$/,
        /kokoro-js[\\/]dist[\\/]kokoro\.web\.js$/,
      ];
    }

    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      sharp$: false,
      "onnxruntime-node$": false,
      "onnxruntime-node": false,
      // Always use the browser build (see NormalModuleReplacementPlugin above).
      "@huggingface/transformers": transformersWeb,
    };

    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        "onnxruntime-node": "commonjs onnxruntime-node",
        "onnxruntime-web": "commonjs onnxruntime-web",
        "onnxruntime-common": "commonjs onnxruntime-common",
        sharp: "commonjs sharp",
      });
    }

    if (!isServer && Array.isArray(config.optimization?.minimizer)) {
      config.optimization.minimizer = config.optimization.minimizer.map((m) => {
        if (m?.options?.terserOptions) {
          m.options.terserOptions = {
            ...m.options.terserOptions,
            ecma: 2020,
            module: true,
            parse: {
              ...(m.options.terserOptions.parse ?? {}),
              ecma: 2020,
            },
          };
        }
        if (m?.options?.minimizer?.options) {
          m.options.minimizer.options = {
            ...m.options.minimizer.options,
            ecma: 2020,
            module: true,
          };
        }
        return m;
      });
    }

    return config;
  },
};

module.exports = nextConfig;
