import { isStorefrontAllowedGatewayPath } from './storefront-route-policy.middleware';

describe('isStorefrontAllowedGatewayPath', () => {
  it('allows guest catalog and customer catalog', () => {
    expect(isStorefrontAllowedGatewayPath('/api/inv/public/products', 'GET')).toBe(true);
    expect(isStorefrontAllowedGatewayPath('/api/inv/customer/products', 'GET')).toBe(true);
  });

  it('denies admin inventory product routes', () => {
    expect(isStorefrontAllowedGatewayPath('/api/inv/products', 'GET')).toBe(false);
    expect(isStorefrontAllowedGatewayPath('/api/inv/internal/products/foo', 'GET')).toBe(false);
  });

  it('allows customer auth and me, denies admin customers', () => {
    expect(isStorefrontAllowedGatewayPath('/api/cus/auth/signin', 'POST')).toBe(true);
    expect(isStorefrontAllowedGatewayPath('/api/cus/me', 'GET')).toBe(true);
    expect(isStorefrontAllowedGatewayPath('/api/cus/me/addresses', 'GET')).toBe(true);
    expect(isStorefrontAllowedGatewayPath('/api/cus/customers', 'GET')).toBe(false);
    expect(isStorefrontAllowedGatewayPath('/api/cus/internal/customers/x/snapshot', 'GET')).toBe(false);
  });

  it('allows ord/me, denies generic orders admin', () => {
    expect(isStorefrontAllowedGatewayPath('/api/ord/me/orders', 'GET')).toBe(true);
    expect(isStorefrontAllowedGatewayPath('/api/ord/orders', 'GET')).toBe(false);
  });

  it('allows OPTIONS', () => {
    expect(isStorefrontAllowedGatewayPath('/api/inv/products', 'OPTIONS')).toBe(true);
  });
});
