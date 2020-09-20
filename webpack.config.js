const path = require('path');
const WebpackPkgPlugin = require('webpack-pkg-plugin-v4').WebpackPkgPlugin

module.exports = {
    entry: './src/litepack.js',
    output: {
        filename: 'litepack.js',
        path: path.resolve(__dirname, 'dist'),
    },
    target: 'node',
    plugins: [
        new WebpackPkgPlugin({
            // Default params:
            targets: ['win-x86'], // array of targets (--targets option)
            output: '/pkg', // Path for dir with executables inside your output folder (--out-path)
        })
    ]
};