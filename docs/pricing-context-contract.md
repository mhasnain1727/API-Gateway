# Pricing Context Contract

For all customer-facing product pricing responses:

- Resolve and pass `priceListCode` from authenticated customer context when available.
- Pass `modeCode` explicitly as `DELIVERY` for current storefront/dashboard selling flows.
- If customer list has no matching product row, inventory must fallback to `DEFAULT`.

## Compatibility

- Existing clients that do not provide `modeCode` should be interpreted as `DELIVERY` during v1 rollout.
- Collection/purchase pricing should not reuse customer grouping semantics.
