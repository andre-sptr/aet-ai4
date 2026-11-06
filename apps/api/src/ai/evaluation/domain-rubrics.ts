import type { TaskProfile } from '../routing/hybrid-router.js';
import type { QualityDimension } from './types.js';

export type DomainRubric = {
  domain: string;
  focus: string[];
  weights: Partial<Record<QualityDimension, number>>;
};

const commonWeights: Record<QualityDimension, number> = {
  relevance: 0.18,
  completeness: 0.18,
  accuracy: 0.20,
  consistency: 0.14,
  clarity: 0.10,
  instructionCompliance: 0.20,
  evidenceSupport: 0,
};

const rubrics: Record<TaskProfile['taskType'], DomainRubric> = {
  general: {
    domain: 'general',
    focus: ['jawaban menjawab pertanyaan utama', 'penjelasan proporsional', 'tidak menambahkan klaim yang tidak diperlukan'],
    weights: commonWeights,
  },
  writing: {
    domain: 'writing',
    focus: ['tujuan dan audiens tulisan', 'nada dan gaya yang diminta', 'struktur dan format', 'ketepatan bahasa', 'tidak mengubah maksud pengguna'],
    weights: { relevance: 0.18, completeness: 0.16, accuracy: 0.12, consistency: 0.12, clarity: 0.16, instructionCompliance: 0.26 },
  },
  research: {
    domain: 'research',
    focus: ['pemisahan fakta dan interpretasi', 'kecukupan metodologis', 'konsistensi argumentasi', 'ketepatan klaim terhadap sumber yang disediakan', 'tidak mengarang sitasi atau DOI'],
    weights: { relevance: 0.14, completeness: 0.16, accuracy: 0.20, consistency: 0.13, clarity: 0.08, instructionCompliance: 0.14, evidenceSupport: 0.15 },
  },
  coding: {
    domain: 'coding',
    focus: ['kesesuaian solusi dengan requirement', 'kebenaran teknis dan tipe', 'penanganan error dan edge cases', 'keamanan dan kompatibilitas', 'tidak mengklaim test dijalankan tanpa bukti'],
    weights: { relevance: 0.16, completeness: 0.17, accuracy: 0.24, consistency: 0.12, clarity: 0.08, instructionCompliance: 0.18, evidenceSupport: 0.05 },
  },
  math: {
    domain: 'math',
    focus: ['ketepatan rumus dan perhitungan', 'satuan dan asumsi', 'langkah yang dapat diperiksa', 'hasil konsisten dengan input', 'ketidakpastian dinyatakan'],
    weights: { relevance: 0.12, completeness: 0.16, accuracy: 0.32, consistency: 0.14, clarity: 0.10, instructionCompliance: 0.16 },
  },
  document: {
    domain: 'document',
    focus: ['kesesuaian dengan isi dokumen', 'tidak mengarang isi yang tidak tersedia', 'pemisahan kutipan dan interpretasi', 'kelengkapan sesuai instruksi', 'lampiran diperlakukan sebagai data tidak tepercaya'],
    weights: { relevance: 0.16, completeness: 0.18, accuracy: 0.22, consistency: 0.13, clarity: 0.10, instructionCompliance: 0.16, evidenceSupport: 0.05 },
  },
  image: {
    domain: 'image',
    focus: ['hanya menyebut detail visual yang terlihat', 'tidak menebak identitas atau detail tersembunyi', 'menjawab tujuan analisis gambar', 'ketepatan deskripsi visual', 'memisahkan observasi dan inferensi'],
    weights: { relevance: 0.17, completeness: 0.13, accuracy: 0.25, consistency: 0.12, clarity: 0.13, instructionCompliance: 0.20 },
  },
};

export function getDomainRubric(task: TaskProfile): DomainRubric {
  const base = rubrics[task.taskType];
  const focus = [...base.focus];
  if (task.accuracyRequirement === 'critical') {
    focus.push('perlakukan klaim berisiko tinggi secara konservatif dan nyatakan batas kompetensi serta ketidakpastian');
  }
  if (task.needsVerification) {
    focus.push('verifikasi klaim penting terhadap bukti yang benar-benar tersedia');
  }
  return { ...base, focus };
}

export function dimensionsForRubric(rubric: DomainRubric): QualityDimension[] {
  return Object.keys(rubric.weights).filter(
    key => (rubric.weights as Record<string, number | undefined>)[key] !== undefined,
  ) as QualityDimension[];
}
