# Deployment (Cloudflare Pages)

```bash
npm run build:pages
npm run deploy:pages
```

The production build strips source maps, bundles the WASM artifacts, validates Pages file limits, scans output for local secret values, and copies `public/_headers` (CSP includes `wasm-unsafe-eval`).

`.github/workflows/deploy-pages.yml` validates pull requests and deploys pushes to `main`. Required GitHub configuration:

- Repository secret `CLOUDFLARE_API_TOKEN`, scoped to Account / Cloudflare Pages / Edit
- Repository variable `CLOUDFLARE_ACCOUNT_ID`
