# Webpack Block Template

This is a standardized template for creating Module Federation blocks in the MEXT system.

## Features

- 🔧 **Webpack 5** with Module Federation
- ⚛️ **React 19** with TypeScript
- 🎨 **CSS Loader** support
- 🔥 **Hot Module Replacement** for development
- 📦 **Independent Dependencies** - no sharing to avoid conflicts

## Structure

```
src/
├── index.tsx     # Entry point for development
├── App.tsx       # Main component (exported as ./Block)
└── ...          # Your custom components
```

## Development

```bash
npm install
npm run dev      # Start development server on port 3001
```

## Build for Production

```bash
npm run build    # Creates dist/ with remoteEntry.js
```

## Module Federation

This template exposes:
- `./Block` → `./src/App` component

The block can receive props from the host application:
- `title?: string` - Custom title for the block
- `data?: any` - Any data passed from the host

## Usage as Federation Module

```javascript
// In host application
const RemoteBlock = React.lazy(() => import('blockName/Block'));

<RemoteBlock title="Custom Title" data={someData} />
```

## Customization

1. Replace `src/App.tsx` with your custom component
2. Add dependencies to `package.json`
3. The backend will automatically use this template and inject your files

## Important Notes

- The `name` in `webpack.config.js` will be replaced automatically by the backend
- All dependencies are bundled independently (no sharing)
- CORS headers are configured for federation module loading 
