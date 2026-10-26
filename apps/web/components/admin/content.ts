export type ContentKind = "news" | "events" | "team";

export type ContentRow = {
  id: string;
  title?: string;
  slug?: string;
  summary?: string | null;
  content?: string;
  imageUrl?: string | null;
  published?: boolean;
  description?: string;
  location?: string | null;
  startDate?: string;
  endDate?: string | null;
  name?: string;
  position?: string;
  bio?: string | null;
  photoUrl?: string | null;
  order?: number;
  socials?: Record<string, string> | null;
};

export type ContentForm = {
  title: string;
  slug: string;
  summary: string;
  content: string;
  imageUrl: string;
  published: boolean;
  description: string;
  location: string;
  startDate: string;
  endDate: string;
  name: string;
  position: string;
  bio: string;
  photoUrl: string;
  order: number;
  socials: string;
};

export function makeSlug(title: string) {
  return title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

/** datetime-local fields always represent WIB, independently of the browser timezone. */
export function toWibInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 16);
}

export function fromWibInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Tanggal kegiatan tidak valid.");
  const date = new Date(`${value}:00+07:00`);
  if (Number.isNaN(date.getTime()) || toWibInput(date.toISOString()) !== value) throw new Error("Tanggal kegiatan tidak valid.");
  return date.toISOString();
}

export function emptyForm(): ContentForm {
  return { title: "", slug: "", summary: "", content: "", imageUrl: "", published: false, description: "", location: "", startDate: "", endDate: "", name: "", position: "", bio: "", photoUrl: "", order: 0, socials: "" };
}

export function rowToForm(row: ContentRow): ContentForm {
  const initial = emptyForm();
  return {
    ...initial,
    title: row.title ?? "", slug: row.slug ?? "", summary: row.summary ?? "", content: row.content ?? "", imageUrl: row.imageUrl ?? "", published: row.published ?? false,
    description: row.description ?? "", location: row.location ?? "", startDate: toWibInput(row.startDate), endDate: toWibInput(row.endDate),
    name: row.name ?? "", position: row.position ?? "", bio: row.bio ?? "", photoUrl: row.photoUrl ?? "", order: row.order ?? 0, socials: row.socials ? JSON.stringify(row.socials, null, 2) : "",
  };
}

function optionalUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const url = new URL(trimmed);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Gunakan URL gambar HTTP atau HTTPS yang valid.");
  return url.href;
}

export function formPayload(kind: ContentKind, form: ContentForm) {
  if (kind === "news") {
    const slug = form.slug.trim() || makeSlug(form.title);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Slug hanya boleh berisi huruf kecil, angka, dan tanda hubung.");
    return { title: form.title.trim(), slug, summary: form.summary.trim() || null, content: form.content, imageUrl: optionalUrl(form.imageUrl), published: form.published };
  }
  if (kind === "events") {
    const startDate = fromWibInput(form.startDate);
    const endDate = form.endDate ? fromWibInput(form.endDate) : null;
    if (endDate && endDate < startDate) throw new Error("Waktu selesai tidak boleh sebelum waktu mulai.");
    return { title: form.title.trim(), description: form.description, location: form.location.trim() || null, startDate, endDate, imageUrl: optionalUrl(form.imageUrl), published: form.published };
  }
  let socials: Record<string, string> | null = null;
  if (form.socials.trim()) {
    const parsed: unknown = JSON.parse(form.socials);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.entries(parsed).some(([key, value]) => !key || typeof value !== "string" || !/^https?:\/\//i.test(value))) throw new Error("Tautan sosial harus berupa objek JSON dengan URL HTTP/HTTPS.");
    socials = parsed as Record<string, string>;
  }
  if (!Number.isInteger(form.order) || form.order < 0) throw new Error("Urutan tampilan harus angka bulat nol atau lebih.");
  return { name: form.name.trim(), position: form.position.trim(), bio: form.bio.trim() || null, photoUrl: optionalUrl(form.photoUrl), order: form.order, socials };
}
