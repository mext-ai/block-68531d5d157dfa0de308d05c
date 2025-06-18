const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;

module.exports = {
  mode: 'production',
  entry: './src/index.tsx',
  devtool: 'source-map',
  devServer: {
    port: 3001,
    open: true,
    hot: true,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',
    }),
    new ModuleFederationPlugin({
      name: 'threescene',
      filename: 'remoteEntry.js',
      exposes: {
        './Block': './src/App',
      },
      // CRITICAL: Empty object = no shared dependencies, full isolation
      shared: {},
    }),
  ],
  externals: {},
  optimization: {
    splitChunks: false,
    concatenateModules: true,
  },
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
    library: {
      type: 'var',
      name: 'threescene'
    },
    publicPath: 'auto',
  },
};
