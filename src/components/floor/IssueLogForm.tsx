"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useLanguage } from "@/lib/use-language";
import type { TableState } from "./types";

export function IssueLogForm({
  tables,
  onClose,
  onSubmit,
}: {
  tables: TableState[];
  onClose: () => void;
  onSubmit: (category: string, tableId: number | null, description: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [category, setCategory] = useState<string>("service");
  const [tableId, setTableId] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const categories = [
    { id: "service", label: t("floor.issue.service"), color: "bg-status-info-500" },
    { id: "food", label: t("floor.issue.food"), color: "bg-status-warn-500" },
    { id: "cleanliness", label: t("floor.issue.cleanliness"), color: "bg-status-good-500" },
    { id: "billing", label: t("floor.issue.billing"), color: "bg-status-bad-500" },
    { id: "other", label: t("floor.issue.other"), color: "bg-sand-500" },
  ];
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-sand-900/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: "spring", damping: 25 }}
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-sand-100 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-status-bad-600">{t("floor.logIssueTitle")}</p>
            <p className="text-[11px] text-text-secondary">{t("floor.logIssueHint")}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg text-text-muted hover:bg-sand-100 text-lg">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-2">{t("floor.issue.category")}</p>
            <div className="grid grid-cols-2 gap-1.5">
              {categories.map((c) => (
                <button key={c.id} onClick={() => setCategory(c.id)}
                  className={`px-3 py-2 rounded-lg border-2 text-[11px] font-bold text-left transition ${
                    category === c.id
                      ? "border-status-bad-500 bg-status-bad-50 text-status-bad-700"
                      : "border-sand-200 bg-white text-text-secondary hover:border-sand-300"
                  }`}>
                  <span className={`inline-block w-2 h-2 rounded-full ${c.color} mr-1.5 align-middle`} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-2">
              {t("floor.issue.tableOptional")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setTableId(null)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold ${tableId === null ? "bg-sand-800 text-white" : "bg-sand-100 text-text-secondary"}`}>
                {t("floor.issue.noTable")}
              </button>
              {tables.filter((tb) => tb.status !== "empty").map((tb) => (
                <button key={tb.id} onClick={() => setTableId(tb.id)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold ${tableId === tb.id ? "bg-sand-800 text-white" : "bg-sand-100 text-text-secondary hover:bg-sand-200"}`}>
                  T{tb.id}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-2">{t("floor.issue.description")}</p>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              placeholder={t("floor.issue.placeholder")}
              className="w-full px-3 py-2.5 rounded-lg border border-sand-200 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-status-bad-400 focus:ring-2 focus:ring-status-bad-100 resize-none" />
          </div>
        </div>
        <div className="px-5 py-3 bg-sand-50 border-t border-sand-100 flex items-center gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-white border border-sand-200 text-[12px] font-bold text-text-secondary active:scale-95">
            {t("floor.issue.cancel")}
          </button>
          <button
            onClick={async () => {
              if (!description.trim() || submitting) return;
              setSubmitting(true);
              await onSubmit(category, tableId, description.trim());
              setSubmitting(false);
            }}
            disabled={!description.trim() || submitting}
            className="flex-[2] px-3 py-2 rounded-lg bg-status-bad-600 text-white text-[12px] font-bold disabled:opacity-50 active:scale-95">
            {submitting ? "…" : t("floor.issue.submit")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
