# Vendas atribuídas ao criador

Webhook de pedido com o essencial de uma loja: id, total, cupom, UTM e status. Cada venda vai para no máximo um criador, e o estorno desconta do líquido sem apagar a venda nem a atribuição. Não conecta numa Shopify de verdade.

Comece a leitura por [`src/attribute.ts`](src/attribute.ts) e, no estorno antecipado, por [`src/ledger.ts`](src/ledger.ts). `src/sales.ts` costura as duas com o banco; a rota só repassa.

## Regras

Entrada:

- Total: `total_cents` inteiro, ou `total_price` / `amount` com no máximo duas casas. `150.00` vira 15000. Mais casas → 400.
- Cupom: `coupon` ou `discount_codes[0].code`, comparado em maiúsculas.
- UTM: `utm_content` ou o `utm_content` da query de `landing_site`. Só conta se for o id de um criador conhecido.

Atribuição (`src/attribute.ts`):

1. Cupom e UTM do mesmo criador → esse criador, `cupom e utm concordam`.
2. Criadores diferentes → o cupom vence, `cupom vence utm quando apontam para criadores diferentes`. A resposta guarda `coupon_creator_id` e `utm_creator_id`.
3. Só cupom → `cupom`. Só UTM → `utm`.
4. Nenhum → `creator_id: null`, `sem cupom nem utm de criador`.

Idempotência: o id do pedido e o id do estorno são chave primária, e a aplicação confere antes de inserir. Pedido repetido responde 200 com o mesmo líquido. Estorno repetido responde 200 com o estado já decidido.

Estorno (`src/ledger.ts`): estados `pending`, `applied`, `rejected`. A soma de `applied` nunca passa de `total_cents`. Estorno de pedido que ainda não chegou fica `pending` com 202 e motivo `pedido ainda não chegou`. Quando o pedido chega, os pendentes aplicam em ordem de `received_at`. O que não couber vira `rejected` com `estorno passaria do valor da venda` e continua no histórico. `net_cents = total_cents - soma(applied)`.

| Request | Status |
| --- | --- |
| `POST /webhooks/orders` novo | 201 |
| `POST /webhooks/orders` repetido | 200 |
| `POST /webhooks/refunds` aplicado | 201 |
| `POST /webhooks/refunds` sem pedido ainda | 202 |
| `POST /webhooks/refunds` acima do saldo | 409, estado `rejected` |
| `POST /webhooks/refunds` repetido | 200 |
| `GET /orders/:id` | 200 ou 404 |

## Como rodar

Node 22 ou maior.

```bash
npm install
npm test
npm run typecheck
npm run dev
```

A API sobe em `http://127.0.0.1:43123`, com os criadores `crt_ana` (cupom `ANA10`) e `crt_bruno` (cupom `BRUNO10`).

## Exemplo: estorno que chega antes do pedido

O teste `estorno antes do pedido fica pendente com 202 e aplica quando o pedido chega` executa estes requests.

```bash
curl -s -X POST http://127.0.0.1:43123/webhooks/refunds \
  -H 'content-type: application/json' \
  -d '{"id":"rf_3","order_id":"ord_1004","amount_cents":2500,"received_at":"2026-06-01T10:00:00.000Z"}'

curl -s -X POST http://127.0.0.1:43123/webhooks/orders \
  -H 'content-type: application/json' \
  -d '{"id":"ord_1004","amount":80,"landing_site":"https://loja.exemplo/?utm_content=crt_bruno"}'
```

Primeira resposta, `202`:

```json
{
  "id": "rf_3",
  "order_id": "ord_1004",
  "amount_cents": 2500,
  "state": "pending",
  "reason": "pedido ainda não chegou",
  "received_at": "2026-06-01T10:00:00.000Z"
}
```

Segunda resposta, `201`:

```json
{
  "id": "ord_1004",
  "status": "paid",
  "total_cents": 8000,
  "net_cents": 5500,
  "attribution": {
    "creator_id": "crt_bruno",
    "rule": "utm",
    "coupon_creator_id": null,
    "utm_creator_id": "crt_bruno"
  },
  "refunds": [
    {
      "id": "rf_3",
      "order_id": "ord_1004",
      "amount_cents": 2500,
      "state": "applied",
      "reason": null,
      "received_at": "2026-06-01T10:00:00.000Z"
    }
  ]
}
```

## Ficou de fora

Vários cupons no mesmo pedido, chargeback e moeda diferente de BRL.

## Nota da entrega

Comece por `src/attribute.ts` (quem leva a venda) e `src/ledger.ts` (estorno). Cada pedido vai para no máximo um criador. Quando cupom e UTM apontam para pessoas diferentes, o cupom vence, porque alguém digitou o código no checkout, e a resposta mostra os dois ids para a disputa ser auditável. UTM que não é id de criador conhecido não conta. Pedido e estorno repetidos não somam: o id é chave primária e a aplicação confere antes. O estorno nunca passa do total: o que não cabe fica `rejected` com motivo e continua visível. Estorno que chega antes do pedido fica `pending` com 202 e aplica, na ordem de recebimento, quando o pedido chega. Nada é apagado.

Testes: `npm test` com 7 passando, `npm run typecheck` sem erro. O exemplo deste README é o request do teste do estorno antecipado.

Ficou de fora: vários cupons no mesmo pedido, chargeback e moeda diferente de BRL.

IA: código, testes e README escritos com assistente de código (Claude Code), a partir de um plano com as regras do desafio. O assistente rodou os testes e o typecheck e colou a resposta real acima.
