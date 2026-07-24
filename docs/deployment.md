# Deployment (Cloudflare Pages)

```bash
npm run build:pages
npm run deploy:pages
```

The production build strips source maps, bundles the WASM artifacts, validates Pages file
limits, scans output for local secret values, and generates `dist/_headers` from
`public/_headers.template` with the configured imagery origin (CSP includes
`wasm-unsafe-eval`).

`.github/workflows/deploy-pages.yml` validates pull requests and deploys pushes to `main`.
Required GitHub configuration:

- Repository secret `CLOUDFLARE_API_TOKEN`, scoped to Account / Cloudflare Pages / Edit
- Repository variable `CLOUDFLARE_ACCOUNT_ID`

On the deployed site the ⋮ → Settings form is read-only (Copy config JSON). Live
retargeting from the UI is developed separately in the `wildfire-boundary-tracker` fork;
here the config only changes through the repo.
