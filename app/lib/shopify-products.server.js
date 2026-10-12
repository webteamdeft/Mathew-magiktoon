const PRODUCTS_QUERY = `#graphql
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: TITLE) {
      nodes {
        id
        title
        handle
        status
        productType
        featuredImage {
          url
          altText
        }
        variants(first: 20) {
          nodes {
            id
            title
            sku
            price
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export async function listShopifyProducts(admin) {
  const products = [];
  let after = null;

  do {
    const response = await admin.graphql(
      PRODUCTS_QUERY,
      {
        variables: {
          first: 100,
          after,
        },
      }
    );

    const payload = await response.json();

    if (payload.errors?.length) {
      throw new Error(
        payload.errors
          .map((error) => error.message)
          .join(", ")
      );
    }

    const connection =
      payload.data?.products;

    if (!connection) {
      throw new Error(
        "Shopify products were not returned."
      );
    }

    products.push(...connection.nodes);

    after = connection.pageInfo.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (after);

  return products;
}