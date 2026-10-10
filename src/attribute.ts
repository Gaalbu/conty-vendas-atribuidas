export type Attribution = {
  creator_id: string | null;
  rule: string;
  coupon_creator_id: string | null;
  utm_creator_id: string | null;
};

// No máximo um criador por pedido. Quando cupom e UTM apontam para pessoas
// diferentes, o cupom vence: alguém digitou o código no checkout, e o UTM pode
// ser só o último link clicado. Os dois ids ficam na resposta.
export function attribute(input: {
  couponCreatorId: string | null;
  utmCreatorId: string | null;
}): Attribution {
  const coupon = input.couponCreatorId;
  const utm = input.utmCreatorId;
  const ids = { coupon_creator_id: coupon, utm_creator_id: utm };

  if (coupon && utm && coupon === utm) return { creator_id: coupon, rule: "cupom e utm concordam", ...ids };
  if (coupon && utm) {
    return { creator_id: coupon, rule: "cupom vence utm quando apontam para criadores diferentes", ...ids };
  }
  if (coupon) return { creator_id: coupon, rule: "cupom", ...ids };
  if (utm) return { creator_id: utm, rule: "utm", ...ids };
  return { creator_id: null, rule: "sem cupom nem utm de criador", ...ids };
}
