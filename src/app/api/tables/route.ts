import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function GET() {
  try {
    const tables = await useCases.tableManagement.list();
    return NextResponse.json({
      tables: tables.map((t) => ({ id: t.id, number: t.number, label: t.label })),
    });
  } catch (err) {
    console.error("Failed to fetch tables:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await useCases.tableManagement.addNext(body.label || null);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("Failed to add table:", err);
    return NextResponse.json({ error: "Failed to add table" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { tableNumber } = body;
    if (!tableNumber) {
      return NextResponse.json({ error: "tableNumber required" }, { status: 400 });
    }
    const result = await useCases.tableManagement.deleteByNumber(Number(tableNumber));
    if (!result.ok) {
      if (result.reason === "not_found") {
        return NextResponse.json({ error: "Table not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: "Table has an active session — close it first" },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to remove table:", err);
    return NextResponse.json({ error: "Failed to remove table" }, { status: 500 });
  }
}
