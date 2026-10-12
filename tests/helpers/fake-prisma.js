/**
 * A tiny in-memory stand-in for the Prisma client, good enough for the
 * fulfillment tests.
 *
 * The important behaviour it reproduces faithfully is the
 * `(shop, shopifyOrderId, shopifyLineItemId)` unique index on
 * `GelatoOrderItem`, because that index is what makes the `orders/create`
 * webhook idempotent.
 */

function matchesWhere(row, where) {
  for (const [key, condition] of Object.entries(where || {})) {
    if (condition && typeof condition === "object" && !Array.isArray(condition)) {
      if ("in" in condition && !condition.in.includes(row[key])) return false;
      if ("lt" in condition && !(row[key] < condition.lt)) return false;
      if ("gte" in condition && !(row[key] >= condition.gte)) return false;

      continue;
    }

    if (row[key] !== condition) {
      return false;
    }
  }

  return true;
}

function applyData(row, data) {
  for (const [key, value] of Object.entries(data || {})) {
    if (value && typeof value === "object" && "increment" in value) {
      row[key] = (row[key] || 0) + value.increment;
      continue;
    }

    row[key] = value;
  }

  return row;
}

export function createFakePrisma({ customizations = [] } = {}) {
  const gelatoOrderItems = [];
  let sequence = 0;

  const uniqueKey = (row) =>
    `${row.shop}::${row.shopifyOrderId}::${row.shopifyLineItemId}`;

  return {
    /** Test-only view of the stored rows. */
    _rows: gelatoOrderItems,

    customization: {
      async findFirst({ where }) {
        return (
          customizations.find((customization) =>
            matchesWhere(customization, { id: where.id, shop: where.shop }),
          ) || null
        );
      },
    },

    gelatoOrderItem: {
      async create({ data }) {
        const candidate = {
          id: `row_${++sequence}`,
          attempts: 0,
          quantity: 1,
          status: "PENDING",
          gelatoOrderId: null,
          lastError: null,
          createdAt: new Date(),
          ...data,
        };

        const duplicate = gelatoOrderItems.some(
          (row) => uniqueKey(row) === uniqueKey(candidate),
        );

        if (duplicate) {
          const error = new Error(
            "Unique constraint failed on the fields: (`shop`,`shopifyOrderId`,`shopifyLineItemId`)",
          );
          error.code = "P2002";
          throw error;
        }

        gelatoOrderItems.push(candidate);

        return { ...candidate };
      },

      async update({ where, data }) {
        const row = gelatoOrderItems.find((item) => item.id === where.id);

        if (!row) {
          throw new Error(`No GelatoOrderItem with id ${where.id}`);
        }

        return { ...applyData(row, data) };
      },

      async updateMany({ where, data }) {
        const rows = gelatoOrderItems.filter((row) => matchesWhere(row, where));

        rows.forEach((row) => applyData(row, data));

        return { count: rows.length };
      },

      async findMany({ where } = {}) {
        return gelatoOrderItems
          .filter((row) => matchesWhere(row, where))
          .map((row) => ({ ...row }));
      },
    },
  };
}
