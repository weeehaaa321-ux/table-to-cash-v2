"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { MenuItem, AddOn } from "@/types/menu";

export function AddOnSheet({
  item,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  onAdd: (addOns: AddOn[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const selectedAddOns = item.addOns.filter((a) => selected.has(a.id));
  const addOnTotal = selectedAddOns.reduce((s, a) => s + a.price, 0);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm z-40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Sheet */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl max-h-[70dvh] overflow-auto safe-bottom"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
      >
        <div className="p-6">
          {/* Handle */}
          <div className="w-10 h-1 rounded-full bg-sand-300 mx-auto mb-5" />

          <h3 className="text-xl font-bold text-text-primary mb-1">
            {item.name}
          </h3>
          <p className="text-text-secondary mb-5">
            Make it yours — add extras
          </p>

          {/* Add-ons list */}
          <div className="space-y-3 mb-6">
            {item.addOns.map((addon) => (
              <button
                key={addon.id}
                onClick={() => toggle(addon.id)}
                className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all ${
                  selected.has(addon.id)
                    ? "border-ocean-400 bg-ocean-50"
                    : "border-sand-200 bg-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      selected.has(addon.id)
                        ? "border-ocean-500 bg-ocean-500"
                        : "border-sand-300"
                    }`}
                  >
                    {selected.has(addon.id) && (
                      <span className="text-white text-xs font-bold">✓</span>
                    )}
                  </div>
                  <span className="font-medium text-text-primary">
                    {addon.name}
                  </span>
                </div>
                <span className="text-ocean-600 font-semibold">
                  +{addon.price} EGP
                </span>
              </button>
            ))}
          </div>

          {/* Add to cart button */}
          <button
            onClick={() => onAdd(selectedAddOns)}
            className="btn-primary w-full text-center text-lg"
          >
            Add to Cart — {item.price + addOnTotal} EGP
          </button>
        </div>
      </motion.div>
    </>
  );
}
