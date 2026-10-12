import {
  Page,
  Card,
  Text,
  Banner,
  Select,
  Button,
  FormLayout,
  TextField,
  BlockStack,
  InlineStack,
  InlineGrid,
  Box,
  Badge,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deletePrompt, listPromptsWithUsage } from "../lib/prompts.server";
import { canDeletePrompt, promptUsageLabel } from "../lib/prompt-usage";

const STATUS_OPTIONS = [
  { label: "Draft", value: "DRAFT" },
  { label: "Active", value: "ACTIVE" },
  { label: "Modify", value: "MODIFY" },
];

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  // Loaded with usage counts so a prompt a product depends on cannot be
  // deleted by accident — see `prompt-usage.js`.
  const prompts = await listPromptsWithUsage(session.shop);

  return { prompts };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "delete") {
    const result = await deletePrompt(session.shop, formData.get("id"));

    if (!result.ok) {
      return { error: result.error };
    }

    return { success: `"${result.name}" was deleted.` };
  }

  if (intent === "update-status") {
    const id = String(formData.get("id") || "");
    const status = String(formData.get("status") || "");
    const allowedStatuses = ["DRAFT", "ACTIVE", "MODIFY"];

    if (!id) return { error: "Prompt ID is missing." };
    if (!allowedStatuses.includes(status)) return { error: "Invalid prompt status." };

    const prompt = await db.prompt.findFirst({ where: { id, shop: session.shop } });

    if (!prompt) return { error: "Prompt was not found for this store." };

    await db.prompt.update({
      where: { id: prompt.id },
      data: { status, version: { increment: 1 } },
    });

    return { success: `"${prompt.name}" status changed to ${status}.` };
  }

  const id = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim();
  const content = String(formData.get("content") || "").trim();
  const status = String(formData.get("status") || "DRAFT");

  if (!name) return { error: "Prompt name is required." };
  if (!content) return { error: "Prompt content is required." };

  if (id) {
    const existingPrompt = await db.prompt.findFirst({ where: { id, shop: session.shop } });

    if (!existingPrompt) return { error: "Prompt was not found for this store." };

    await db.prompt.update({
      where: { id: existingPrompt.id },
      data: { name, content, status, version: { increment: 1 } },
    });

    return { success: "Prompt updated successfully." };
  }

  const duplicatePrompt = await db.prompt.findFirst({ where: { shop: session.shop, name } });

  if (duplicatePrompt) return { error: `A prompt named "${name}" already exists.` };

  try {
    await db.prompt.create({ data: { shop: session.shop, name, content, status } });
  } catch (error) {
    if (error?.code === "P2002") return { error: `A prompt named "${name}" already exists.` };

    throw error;
  }

  return { success: "Prompt created successfully." };
}

function statusTone(status) {
  if (status === "ACTIVE") return "success";
  if (status === "MODIFY") return "warning";

  return "attention";
}

/**
 * Blank values for the create form.
 *
 * Polaris `TextField` and `Select` are controlled: without a `value` and an
 * `onChange` they render an input whose value never changes, so typing appears
 * to do nothing and the form submits empty. Every field here is therefore
 * backed by state.
 */
const EMPTY_DRAFT = { name: "", content: "", status: "DRAFT" };

export default function Prompts() {
  const { prompts } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [draft, setDraft] = useState(EMPTY_DRAFT);

  // Which prompt is open for editing, and the values being edited. Existing
  // prompts were previously read-only in the UI even though the action already
  // supported updating them, so a merchant had no way to change wording.
  const [editingId, setEditingId] = useState("");
  const [edit, setEdit] = useState(EMPTY_DRAFT);

  // Clear the create form once the server confirms the save, so the next
  // prompt starts blank rather than with the previous one still in the boxes.
  useEffect(() => {
    if (actionData?.success) {
      setDraft(EMPTY_DRAFT);
      setEditingId("");
    }
  }, [actionData]);

  function startEditing(prompt) {
    setEditingId(prompt.id);
    setEdit({
      name: prompt.name,
      content: prompt.content,
      status: prompt.status,
    });
  }

  return (
    <Page
      title="AI prompts"
      subtitle="Create and manage product-specific prompts for Gemini image generation."
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <div className="mt-page-shell">
      <BlockStack gap="500">
        <section className="mt-page-hero">
          <div className="mt-hero-copy">
            <Badge tone="info">Generation logic</Badge>
            <h1>Keep every image prompt clear and reusable</h1>
            <p>
              Save the creative instructions that turn customer uploads into
              production-ready artwork for each personalized product.
            </p>
          </div>
          <div className="mt-hero-panel">
            <BlockStack gap="100">
              <Text as="p" tone="subdued">Saved prompts</Text>
              <Text as="p" variant="heading2xl">{prompts.length}</Text>
            </BlockStack>
            <Badge tone={prompts.some((prompt) => prompt.status === "ACTIVE") ? "success" : "attention"}>
              {prompts.some((prompt) => prompt.status === "ACTIVE") ? "Active prompt ready" : "Needs active prompt"}
            </Badge>
          </div>
        </section>

        {actionData?.success ? (
          <Banner tone="success" title="Done">
            {actionData.success}
          </Banner>
        ) : null}

        {actionData?.error ? (
          <Banner tone="critical" title="Could not complete that">
            {actionData.error}
          </Banner>
        ) : null}

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingLg">
                  Create prompt
                </Text>
                <Text as="p" tone="subdued">
                  Write the instruction Gemini should use when transforming customer photos.
                </Text>
              </BlockStack>

              <Form method="post">
                <input type="hidden" name="intent" value="create" />
                <FormLayout>
                  <TextField
                    label="Prompt name"
                    name="name"
                    value={draft.name}
                    onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
                    autoComplete="off"
                    placeholder="Example: Icon magazine portrait"
                    requiredIndicator
                  />
                  <TextField
                    label="Prompt content"
                    name="content"
                    value={draft.content}
                    onChange={(value) => setDraft((current) => ({ ...current, content: value }))}
                    multiline={7}
                    autoComplete="off"
                    placeholder="Describe the final artwork style, background, and details."
                    helpText="Describe the artwork only. Never mention the mug, bag, frame or any product — the model will draw the product instead of the artwork."
                    requiredIndicator
                  />
                  <Select
                    label="Status"
                    name="status"
                    options={STATUS_OPTIONS}
                    value={draft.status}
                    onChange={(value) => setDraft((current) => ({ ...current, status: value }))}
                    helpText="Only an Active prompt runs on the storefront."
                  />
                  <Button
                    submit
                    variant="primary"
                    loading={isSaving}
                    disabled={!draft.name.trim() || !draft.content.trim()}
                  >
                    Save prompt
                  </Button>
                </FormLayout>
              </Form>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center" gap="300">
                <Text as="h2" variant="headingLg">
                  Saved prompts
                </Text>
                <Badge tone="info">{prompts.length} total</Badge>
              </InlineStack>

              {prompts.length === 0 ? (
                <Box padding="600" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="p" variant="headingMd">
                      No prompts yet
                    </Text>
                    <Text as="p" tone="subdued" alignment="center">
                      Create your first product-specific Gemini prompt.
                    </Text>
                  </BlockStack>
                </Box>
              ) : (
                <BlockStack gap="300">
                  {prompts.map((prompt) => (
                    <Box key={prompt.id} padding="300" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="start" gap="300">
                          <BlockStack gap="100">
                            <Text as="h3" variant="headingMd">
                              {prompt.name}
                            </Text>
                            <Text as="p" tone="subdued">
                              Version {prompt.version} · Updated{" "}
                              {new Date(prompt.updatedAt).toLocaleDateString()} ·{" "}
                              {promptUsageLabel(prompt)}
                            </Text>
                          </BlockStack>

                          <InlineStack gap="200" blockAlign="center">
                            <Badge tone={statusTone(prompt.status)}>{prompt.status}</Badge>
                            <Form method="post" className="mt-select-inline">
                              <input type="hidden" name="intent" value="update-status" />
                              <input type="hidden" name="id" value={prompt.id} />
                              <select
                                name="status"
                                defaultValue={prompt.status}
                                onChange={(event) => event.currentTarget.form.requestSubmit()}
                                aria-label={`Change status for ${prompt.name}`}
                              >
                                <option value="DRAFT">Draft</option>
                                <option value="ACTIVE">Active</option>
                                <option value="MODIFY">Modify</option>
                              </select>
                            </Form>

                            <Button
                              variant="plain"
                              onClick={() =>
                                editingId === prompt.id
                                  ? setEditingId("")
                                  : startEditing(prompt)
                              }
                              accessibilityLabel={`Edit ${prompt.name}`}
                            >
                              {editingId === prompt.id ? "Cancel" : "Edit"}
                            </Button>

                            {/*
                              Deleting is irreversible and `promptId` is
                              SetNull, so a prompt still assigned to a product
                              is not offered for deletion at all — removing it
                              would stop that product generating with no error.
                            */}
                            <Form
                              method="post"
                              onSubmit={(event) => {
                                if (
                                  !window.confirm(
                                    `Delete the prompt "${prompt.name}"? This cannot be undone.`,
                                  )
                                ) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <input type="hidden" name="intent" value="delete" />
                              <input type="hidden" name="id" value={prompt.id} />
                              <Button
                                submit
                                variant="plain"
                                tone="critical"
                                disabled={!canDeletePrompt(prompt) || isSaving}
                                accessibilityLabel={`Delete ${prompt.name}`}
                              >
                                Delete
                              </Button>
                            </Form>
                          </InlineStack>
                        </InlineStack>

                        {editingId === prompt.id ? (
                          <Box padding="300" background="bg-surface" borderRadius="200">
                            <Form method="post">
                              <input type="hidden" name="intent" value="update" />
                              <input type="hidden" name="id" value={prompt.id} />
                              <FormLayout>
                                <TextField
                                  label="Prompt name"
                                  name="name"
                                  value={edit.name}
                                  onChange={(value) =>
                                    setEdit((current) => ({ ...current, name: value }))
                                  }
                                  autoComplete="off"
                                  requiredIndicator
                                />
                                <TextField
                                  label="Prompt content"
                                  name="content"
                                  value={edit.content}
                                  onChange={(value) =>
                                    setEdit((current) => ({ ...current, content: value }))
                                  }
                                  multiline={10}
                                  autoComplete="off"
                                  helpText="Describe the artwork only — never the mug, bag or frame."
                                  requiredIndicator
                                />
                                <Select
                                  label="Status"
                                  name="status"
                                  options={STATUS_OPTIONS}
                                  value={edit.status}
                                  onChange={(value) =>
                                    setEdit((current) => ({ ...current, status: value }))
                                  }
                                />
                                <InlineStack gap="200">
                                  <Button
                                    submit
                                    variant="primary"
                                    loading={isSaving}
                                    disabled={!edit.name.trim() || !edit.content.trim()}
                                  >
                                    Save changes
                                  </Button>
                                  <Button onClick={() => setEditingId("")}>Cancel</Button>
                                </InlineStack>
                              </FormLayout>
                            </Form>
                          </Box>
                        ) : (
                          <Box padding="300" background="bg-surface" borderRadius="200">
                            <Text as="p" tone="subdued">
                              {prompt.content}
                            </Text>
                          </Box>
                        )}
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
      </div>
    </Page>
  );
}
