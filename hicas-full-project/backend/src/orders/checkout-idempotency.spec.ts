import { prepareCheckoutRequest } from './checkout-idempotency';

const addressId = '11111111-1111-4111-8111-111111111111';
const productA = '22222222-2222-4222-8222-222222222222';
const productB = '33333333-3333-4333-8333-333333333333';

describe('checkout idempotency request preparation', () => {
  it('aggregates and sorts equivalent lines into one stable canonical request hash', () => {
    const first = prepareCheckoutRequest(
      {
        addressId: addressId.toUpperCase(),
        customerNote: '  Leave with reception.  ',
        items: [
          { productId: productB, quantity: 1 },
          { productId: productA.toUpperCase(), quantity: 2 },
          { productId: productB.toUpperCase(), quantity: 3 },
        ],
      },
      ' checkout-attempt-1 ',
    );
    const equivalent = prepareCheckoutRequest(
      {
        addressId,
        customerNote: 'Leave with reception.',
        items: [
          { productId: productB, quantity: 4 },
          { productId: productA, quantity: 2 },
        ],
      },
      'checkout-attempt-1',
    );

    expect(first).toMatchObject({
      idempotencyKey: 'checkout-attempt-1',
      addressId,
      customerNote: 'Leave with reception.',
      items: [
        { productId: productA, quantity: 2 },
        { productId: productB, quantity: 4 },
      ],
    });
    expect(first.canonicalJson).toBe(equivalent.canonicalJson);
    expect(first.requestHash).toBe(equivalent.requestHash);
  });

  it('omits client-controlled money and arbitrary address data from the canonical hash', () => {
    const request = prepareCheckoutRequest(
      {
        addressId,
        items: [{ productId: productA, quantity: 1 }],
        customerNote: '   ',
        price: '1',
        shippingFee: '0',
        totalAmount: '1',
        shippingSnapshot: { recipientName: 'Attacker' },
      } as unknown as {
        addressId: string;
        items: Array<{ productId: string; quantity: number }>;
        customerNote?: string;
      },
      'attempt-2',
    );

    expect(request.canonicalJson).toBe(
      JSON.stringify({
        addressId,
        customerNote: null,
        items: [{ productId: productA, quantity: 1 }],
      }),
    );
  });

  it('requires a nonblank idempotency key and positive order lines', () => {
    const dto = { addressId, items: [{ productId: productA, quantity: 1 }] };

    expect(() => prepareCheckoutRequest(dto, '   ')).toThrow('Idempotency-Key');
    expect(() =>
      prepareCheckoutRequest(
        { ...dto, items: [{ productId: productA, quantity: 0 }] },
        'attempt-3',
      ),
    ).toThrow('positive integer');
  });
});
