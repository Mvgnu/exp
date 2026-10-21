import type { Acquirer, Parser, AcquiredDocument } from '@deeplake/core';
export interface AcquisitionOptions { userAgent?: string; maxBytes?: number; timeoutMs?: number; maxRedirects?: number; minHostIntervalMs?: number; respectRobots?: boolean; allowedHosts?: string[] }
export interface ParseOptions { maxSegmentChars?: number; maxPdfPages?: number; pdfTimeoutMs?: number }
export interface CollectionEntry { url: string; title: string; family: string }
export type { Acquirer, Parser, AcquiredDocument };
