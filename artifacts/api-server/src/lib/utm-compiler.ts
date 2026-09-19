export const UTM_CATEGORY_KEYS = [
  "product_line", "campaign_shortcode", "subcampaign", "ads_subtype", "utm_objective",
  "audience", "audience_segment", "utm_region", "creative_type", "image_size",
  "video_length", "content_type", "creative_cta", "content_order", "email_type",
  "owner", "display_partner", "source", "capture_source", "newsletter_version",
  "link_position", "nurture_sequence", "channel",
] as const;

export type UtmCategoryKey = typeof UTM_CATEGORY_KEYS[number];
export type UtmFormula =
  | "paid_search" | "paid_social" | "display" | "newsletter_email"
  | "nurture_email" | "pre_event_email" | "post_event_email" | "events";

export type CompiledUtmInput = {
  formula: UtmFormula;
  values: Partial<Record<UtmCategoryKey, string>>;
  keyword?: string;
  sendDate?: string;
  eventDate?: string;
  automationName?: string;
  eventName?: string;
  creativeDescription?: string;
  eventCta?: string;
  channelSource: string;
  channelMedium: string;
  salesforceCampaignId?: string;
};

export type CompiledUtm = {
  parameters: Record<string, string>;
  automationName: string | null;
};

/** Join non-empty values. Empty segments are omitted, never stringified. */
export function J(...values: Array<string | null | undefined | false>): string {
  return values.filter((value): value is string => Boolean(value)).join("_");
}

export function normalizeGoverned(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "-");
}

function assertDate(field: string, value: string | undefined): string {
  if (!value) throw new UtmInputError(field, "required", `${field} is required`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new UtmInputError(field, "invalid_format", `${field} must use YYYY-MM-DD`);
  }
  return value;
}

function requireFreeText(field: string, value: string | undefined): string {
  if (!value?.trim()) throw new UtmInputError(field, "required", `${field} is required`);
  if (value.trim().toLowerCase() === "undefined") throw new UtmInputError(field, "invalid_value", `${field} cannot be "undefined"`);
  return value;
}

export class UtmInputError extends Error {
  constructor(public field: string, public code: string, message: string) {
    super(message);
  }
}

export function compileUtm(input: CompiledUtmInput): CompiledUtm {
  const v = input.values;
  const base = J(v.product_line, v.subcampaign, v.campaign_shortcode);
  const regionSuffix = v.utm_region ? `_${v.utm_region}` : "";
  let campaign = "";
  let content: string | undefined;
  let term: string | undefined;
  let automationName: string | null = null;

  switch (input.formula) {
    case "paid_search":
      campaign = J(base, v.ads_subtype, v.utm_objective) + regionSuffix;
      content = J(base, v.ads_subtype, v.utm_objective, v.audience, v.audience_segment) + regionSuffix;
      term = requireFreeText("keyword", input.keyword);
      break;
    case "paid_social":
    case "display":
      campaign = J(base, v.ads_subtype, v.utm_objective);
      content = J(base, v.ads_subtype, v.utm_objective, v.audience, v.audience_segment) + regionSuffix;
      term = J(v.creative_type, v.image_size || v.video_length, v.content_type, v.creative_cta);
      break;
    case "newsletter_email": {
      const sendDate = assertDate("sendDate", input.sendDate);
      campaign = J(v.owner, v.product_line, v.subcampaign, v.campaign_shortcode, "nwsltr", v.utm_objective, v.audience, sendDate, v.newsletter_version);
      content = J(v.link_position, v.product_line, v.subcampaign, v.campaign_shortcode, v.content_type);
      break;
    }
    case "nurture_email": {
      const sendDate = assertDate("sendDate", input.sendDate);
      const name = requireFreeText("automationName", input.automationName);
      campaign = J(v.owner, v.product_line, v.subcampaign, v.campaign_shortcode, "nurt", v.utm_objective, v.audience, sendDate, name);
      automationName = J(v.owner, v.product_line, v.subcampaign, v.campaign_shortcode, "nurt", sendDate, name);
      break;
    }
    case "pre_event_email":
    case "post_event_email": {
      const sendDate = assertDate("sendDate", input.sendDate);
      const eventName = requireFreeText("eventName", input.eventName);
      campaign = J(v.owner, v.product_line, v.subcampaign, v.campaign_shortcode, v.email_type, v.utm_objective, v.audience, sendDate, eventName);
      content = J(v.product_line, v.subcampaign, v.campaign_shortcode, v.creative_cta, v.content_type);
      break;
    }
    case "events":
      campaign = J(v.product_line, v.subcampaign, v.campaign_shortcode, v.utm_region, assertDate("eventDate", input.eventDate), requireFreeText("eventName", input.eventName));
      content = J(v.capture_source, requireFreeText("creativeDescription", input.creativeDescription), requireFreeText("eventCta", input.eventCta));
      break;
  }

  const parameters: Record<string, string> = {
    utm_source: input.channelSource,
    utm_medium: input.channelMedium,
    utm_campaign: campaign,
  };
  if (content) parameters.utm_content = content;
  if (term) parameters.utm_term = term;
  if (input.salesforceCampaignId) parameters.utm_sf_cmp_id = input.salesforceCampaignId;
  return { parameters, automationName };
}

export function appendUtm(destinationUrl: string, parameters: Record<string, string>): string {
  let url: URL;
  try {
    url = new URL(destinationUrl);
  } catch {
    throw new UtmInputError("destinationUrl", "invalid_url", "destinationUrl must be a valid http or https URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UtmInputError("destinationUrl", "invalid_url", "destinationUrl must be a valid http or https URL");
  }
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_sf_cmp_id"]) {
    url.searchParams.delete(key);
  }
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url.toString();
}