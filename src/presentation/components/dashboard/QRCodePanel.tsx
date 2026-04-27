"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import QRCode from "qrcode";

// Inline SVG icons — replaces the 📱 🖨 ⬇ emoji glyphs that the
// previous version rendered. Same pixels on every device, no emoji
// font weirdness across iOS/Android/desktop.
function QrCodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM18 14h3M14 18v3M18 18h3v3h-3z" />
    </svg>
  );
}
function PrinterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </svg>
  );
}
function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

type TableInfo = { id: number };

export function QRCodePanel({
  tables,
  restaurantSlug,
  restaurantName,
}: {
  tables: TableInfo[];
  restaurantSlug: string;
  restaurantName: string;
}) {
  const [previewTable, setPreviewTable] = useState<number | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const buildScanUrl = useCallback(
    (tableNumber: number) => {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      return `${origin}/scan?t=${tableNumber}`;
    },
    [],
  );

  useEffect(() => {
    if (previewTable === null) return;
    QRCode.toDataURL(buildScanUrl(previewTable), {
      width: 400,
      margin: 2,
      color: { dark: "#1e293b", light: "#ffffff" },
      errorCorrectionLevel: "L",
    }).then(setPreviewDataUrl);
  }, [previewTable, buildScanUrl]);

  const downloadSingle = useCallback(
    async (tableNumber: number) => {
      const url = buildScanUrl(tableNumber);
      const dataUrl = await QRCode.toDataURL(url, {
        width: 800,
        margin: 2,
        color: { dark: "#1e293b", light: "#ffffff" },
        errorCorrectionLevel: "L",
      });

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      canvas.width = 900;
      canvas.height = 1050;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 50, 50, 800, 800);

        ctx.fillStyle = "#1e293b";
        ctx.font = "bold 48px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`Table ${tableNumber}`, canvas.width / 2, 920);

        ctx.fillStyle = "#64748b";
        ctx.font = "24px system-ui, sans-serif";
        ctx.fillText(restaurantName, canvas.width / 2, 970);

        ctx.fillStyle = "#94a3b8";
        ctx.font = "18px system-ui, sans-serif";
        ctx.fillText("Scan to view menu & order", canvas.width / 2, 1010);

        const link = document.createElement("a");
        link.download = `table-${tableNumber}-qr.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      };
      img.src = dataUrl;
    },
    [buildScanUrl, restaurantName],
  );

  const downloadAll = useCallback(async () => {
    if (tables.length === 0) return;
    setGenerating(true);

    for (const table of tables) {
      await downloadSingle(table.id);
      await new Promise((r) => setTimeout(r, 300));
    }
    setGenerating(false);
  }, [tables, downloadSingle]);

  const printAll = useCallback(async () => {
    if (tables.length === 0) return;
    setGenerating(true);

    const qrImages: { tableNumber: number; dataUrl: string }[] = [];
    for (const table of tables) {
      const dataUrl = await QRCode.toDataURL(buildScanUrl(table.id), {
        width: 600,
        margin: 2,
        color: { dark: "#1e293b", light: "#ffffff" },
        errorCorrectionLevel: "L",
      });
      qrImages.push({ tableNumber: table.id, dataUrl });
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setGenerating(false);
      return;
    }

    const cardsHtml = qrImages
      .map(
        (q) => `
      <div style="page-break-inside:avoid;display:inline-flex;flex-direction:column;align-items:center;padding:20px;margin:10px;border:2px solid #e2e8f0;border-radius:16px;width:280px;">
        <img src="${q.dataUrl}" style="width:240px;height:240px;" />
        <div style="margin-top:12px;font-size:28px;font-weight:800;color:#1e293b;">Table ${q.tableNumber}</div>
        <div style="font-size:14px;color:#64748b;margin-top:4px;">${restaurantName}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Scan to view menu &amp; order</div>
      </div>`,
      )
      .join("");

    printWindow.document.write(`<!DOCTYPE html><html><head><title>QR Codes - ${restaurantName}</title>
      <style>
        body{font-family:system-ui,sans-serif;margin:20px;display:flex;flex-wrap:wrap;justify-content:center;gap:0;}
        @media print{body{margin:0;}div{break-inside:avoid;}}
      </style></head><body>${cardsHtml}
      <script>window.onload=function(){window.print();}</script>
      </body></html>`);
    printWindow.document.close();

    setGenerating(false);
  }, [tables, buildScanUrl, restaurantName]);

  if (tables.length === 0) {
    return (
      <div className="card-luxury p-5">
        <h3 className="text-text-primary font-bold text-sm flex items-center gap-2">
          <QrCodeIcon className="w-4 h-4" /> QR Codes
        </h3>
        <p className="text-text-muted text-xs mt-2">
          Add tables first to generate QR codes.
        </p>
      </div>
    );
  }

  return (
    <div className="card-luxury p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-text-primary font-bold text-sm flex items-center gap-2">
            <QrCodeIcon className="w-4 h-4" /> QR Codes
          </h3>
          <p className="text-text-muted text-[11px] mt-0.5">
            Download or print QR codes for your tables
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={printAll}
            disabled={generating}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-ocean-50 text-ocean-600 border border-ocean-200 hover:bg-ocean-100 transition disabled:opacity-50"
          >
            {generating ? "..." : <><PrinterIcon className="w-3 h-3" /> Print All</>}
          </button>
          <button
            onClick={downloadAll}
            disabled={generating}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-success/10 text-success border border-success/30 hover:bg-success/20 transition disabled:opacity-50"
          >
            {generating ? "..." : <><DownloadIcon className="w-3 h-3" /> Download All</>}
          </button>
        </div>
      </div>

      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))" }}
      >
        {tables.map((table) => (
          <button
            key={table.id}
            onClick={() =>
              setPreviewTable(previewTable === table.id ? null : table.id)
            }
            className={`aspect-square rounded-xl border-2 flex flex-col items-center justify-center transition-all ${
              previewTable === table.id
                ? "bg-ocean-50 border-ocean-300 ring-2 ring-ocean-400 ring-offset-1"
                : "bg-sand-50 border-sand-200 hover:border-ocean-200 hover:bg-ocean-50/50"
            }`}
          >
            <span className="text-xs font-semibold text-text-secondary">
              {table.id}
            </span>
            <span className="text-[7px] font-bold text-ocean-500">QR</span>
          </button>
        ))}
      </div>

      {previewTable !== null && previewDataUrl && (
        <div className="mt-4 flex flex-col items-center gap-3 p-4 bg-white rounded-2xl border border-sand-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewDataUrl}
            alt={`QR for table ${previewTable}`}
            className="w-48 h-48 rounded-xl"
          />
          <div className="text-center">
            <p className="text-sm font-semibold text-text-primary">
              Table {previewTable}
            </p>
            <p className="text-[10px] text-text-muted mt-0.5">
              {buildScanUrl(previewTable)}
            </p>
          </div>
          <button
            onClick={() => downloadSingle(previewTable)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-ocean-500 text-white hover:bg-ocean-600 transition"
          >
            <DownloadIcon className="w-3.5 h-3.5" /> Download This QR
          </button>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
