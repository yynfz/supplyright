"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProductionMutation } from "@/hooks/use-offchain";
import type { Agreement, Criticality, Dependency, Material, Product, ReportedStatus } from "@/lib/offchain-types";
import { CRITICALITY } from "@/lib/risk";

const NONE = "__none__";

function useSave() {
  const mutation = useProductionMutation();
  const run = async (input: Parameters<typeof mutation.mutateAsync>[0], ok: string) => {
    try {
      await mutation.mutateAsync(input);
      toast.success(ok);
      return true;
    } catch (e) {
      toast.error("Gagal menyimpan", { description: (e as Error).message });
      return false;
    }
  };
  return { run, pending: mutation.isPending };
}

export function MaterialDialog({ material, agreements }: { material?: Material; agreements: Agreement[] }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useSave();
  const [form, setForm] = useState(() => ({
    name: material?.name ?? "",
    code: material?.code ?? "",
    criticality: (material?.criticality ?? "HIGH") as Criticality,
    agreement_id: material?.agreement_id ?? NONE,
    reported_status: (material?.reported_status ?? NONE) as ReportedStatus | typeof NONE,
    alternative_suppliers: String(material?.alternative_suppliers ?? 0),
    alternative_lead_days: material?.alternative_lead_days?.toString() ?? "",
    notes: material?.notes ?? "",
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const agreement = agreements.find((a) => a.id === form.agreement_id);
    const data = {
      name: form.name,
      code: form.code,
      criticality: form.criticality,
      agreement_id: agreement?.id ?? null,
      po_hash: agreement?.po_hash ?? null,
      reported_status: form.reported_status === NONE ? null : form.reported_status,
      alternative_suppliers: Number(form.alternative_suppliers || 0),
      alternative_lead_days: form.alternative_lead_days === "" ? null : Number(form.alternative_lead_days),
      notes: form.notes || null,
    };
    const ok = material
      ? await run({ op: "update", type: "material", id: material.id, data }, "Material diperbarui")
      : await run({ op: "create", type: "material", data }, "Material ditambahkan");
    if (ok) setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {material ? (
          <Button variant="ghost" size="icon-xs" aria-label="Ubah material">
            <Pencil />
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <Plus /> Material
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{material ? "Ubah material" : "Tambah material"}</DialogTitle>
          <DialogDescription>Data perencanaan privat; tidak pernah ditulis onchain.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="m-name">Nama material</Label>
            <Input id="m-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="m-code">Kode</Label>
            <Input id="m-code" value={form.code} onChange={(e) => set("code", e.target.value)} />
          </div>
          <div>
            <Label>Kritikalitas</Label>
            <Select value={form.criticality} onValueChange={(v) => set("criticality", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CRITICALITY) as Criticality[]).map((c) => (
                  <SelectItem key={c} value={c}>
                    {CRITICALITY[c].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Tautkan ke perjanjian / Supply Right</Label>
            <Select value={form.agreement_id} onValueChange={(v) => set("agreement_id", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Tanpa PO onchain</SelectItem>
                {agreements.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.po_number} · {a.material_name}
                    {a.token_id ? ` (SR #${a.token_id})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Status pasokan diturunkan otomatis dari Supply Right onchain (via hash PO).
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label>Status yang dilaporkan (offchain)</Label>
            <Select value={form.reported_status} onValueChange={(v) => set("reported_status", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Tidak ada laporan</SelectItem>
                <SelectItem value="ON_TRACK">Sesuai jadwal</SelectItem>
                <SelectItem value="REPORTED_DELAY">Keterlambatan dilaporkan</SelectItem>
                <SelectItem value="ARRIVED">Sudah tiba (tanpa PO onchain)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="m-alt">Pemasok alternatif</Label>
            <Input id="m-alt" type="number" min={0} value={form.alternative_suppliers} onChange={(e) => set("alternative_suppliers", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="m-lead">Lead time alternatif (hari)</Label>
            <Input id="m-lead" type="number" min={0} value={form.alternative_lead_days} onChange={(e) => set("alternative_lead_days", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="m-notes">Catatan</Label>
            <Textarea id="m-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || form.name.length < 2 || form.code.length < 2}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProductDialog({ product }: { product?: Product }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useSave();
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [daily, setDaily] = useState(product?.daily_output_units?.toString() ?? "");
  const [notes, setNotes] = useState(product?.notes ?? "");
  const submit = async () => {
    const data = { name, sku, daily_output_units: daily === "" ? null : Number(daily), notes: notes || null };
    const ok = product
      ? await run({ op: "update", type: "product", id: product.id, data }, "Produk diperbarui")
      : await run({ op: "create", type: "product", data }, "Produk ditambahkan");
    if (ok) setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {product ? (
          <Button variant="ghost" size="icon-xs" aria-label="Ubah produk">
            <Pencil />
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <Plus /> Produk
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{product ? "Ubah produk" : "Tambah produk"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="p-name">Nama produk</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="p-sku">SKU</Label>
              <Input id="p-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="p-daily">Output / hari (unit)</Label>
              <Input id="p-daily" type="number" min={0} value={daily} onChange={(e) => setDaily(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="p-notes">Catatan</Label>
            <Textarea id="p-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || name.length < 2 || sku.length < 2}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DependencyDialog({
  dependency,
  materials,
  products,
}: {
  dependency?: Dependency;
  materials: Material[];
  products: Product[];
}) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useSave();
  const [materialId, setMaterialId] = useState(dependency?.material_id ?? materials[0]?.id ?? "");
  const [productId, setProductId] = useState(dependency?.product_id ?? products[0]?.id ?? "");
  const [blocking, setBlocking] = useState(dependency?.is_blocking ?? true);
  const [days, setDays] = useState(dependency?.est_disruption_days?.toString() ?? "14");
  const [exposure, setExposure] = useState(dependency ? String(Number(dependency.est_financial_exposure)) : "0");
  const submit = async () => {
    const data = {
      material_id: materialId,
      product_id: productId,
      is_blocking: blocking,
      est_disruption_days: Number(days || 0),
      est_financial_exposure: exposure.replace(",", ".") || "0",
    };
    const ok = dependency
      ? await run({ op: "update", type: "dependency", id: dependency.id, data }, "Dependensi diperbarui")
      : await run({ op: "create", type: "dependency", data }, "Dependensi ditambahkan");
    if (ok) setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {dependency ? (
          <Button variant="ghost" size="icon-xs" aria-label="Ubah dependensi">
            <Pencil />
          </Button>
        ) : (
          <Button size="sm" disabled={!materials.length || !products.length}>
            <Plus /> Dependensi
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dependency ? "Ubah dependensi" : "Tambah dependensi"}</DialogTitle>
          <DialogDescription>Material → produk. Angka gangguan dan eksposur adalah estimasi internal.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Material</Label>
            <Select value={materialId} onValueChange={setMaterialId} disabled={!!dependency}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {materials.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Produk</Label>
            <Select value={productId} onValueChange={setProductId} disabled={!!dependency}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={blocking} onCheckedChange={(v) => setBlocking(v === true)} />
            Material wajib (tanpa material ini produk tidak dapat diproduksi)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="d-days">Estimasi gangguan (hari)</Label>
              <Input id="d-days" type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="d-exp">Estimasi eksposur (mETH)</Label>
              <Input id="d-exp" inputMode="decimal" value={exposure} onChange={(e) => setExposure(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !materialId || !productId}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteButton({ type, id, label }: { type: "material" | "product" | "dependency"; id: string; label: string }) {
  const { run, pending } = useSave();
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Hapus ${label}`}
      disabled={pending}
      onClick={() => {
        if (window.confirm(`Hapus ${label}?`)) void run({ op: "delete", type, id }, `${label} dihapus`);
      }}
    >
      <Trash2 className="text-rose-600" />
    </Button>
  );
}
