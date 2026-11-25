import { useEffect, useMemo, useRef, useState } from 'react'
import 'animate.css'
import { Toaster, toast } from 'sonner'
import { Ban, FileText, Info, Loader2, RefreshCw, Search, ShieldCheck, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { StatusModal, type StatusModalType } from '@/components/StatusModal'
import { Archivos, AvisoProveedor, Encabezado, EstadoBadge, NavCfdi } from '@/components/Comun'
import { cn } from '@/lib/utils'
import { inputCls, labelCls, useTheme } from '@/lib/ui'
import {
  cancelarCfdi, coincide, ESTADO_LABEL, formatFecha, formatMoney, getCfdi, getCfdis, getEstatus, getProveedor, MOTIVOS, serieFolio, TIPO_LABEL, validarCancelacion,
  type Cfdi, type Estado, type Proveedor,
} from '@/lib/cfdi'

type Modal = { isOpen: boolean; type: StatusModalType; title: string; message: string }
const th = 'py-1.5 pr-3 font-medium text-[11px] text-slate-500 text-left'
const num = 'tabular-nums text-right whitespace-nowrap'
const selectCls = cn(inputCls, 'px-2 border')

function App() {
  const [theme, setTheme] = useTheme()
  const params = new URLSearchParams(window.location.search)
  const [org] = useState(() => params.get('organization_id'))
  const [inicial] = useState(() => { const v = Number(params.get('cfdi_id')); return Number.isInteger(v) && v > 0 ? v : null })
  const [modal, setModal] = useState<Modal>({ isOpen: !org, type: 'error', title: 'Error de Inicialización', message: 'No se detectó la organización relacionada. Es necesario incluir el parámetro "organization_id" en la URL.' })

  const [prov, setProv] = useState<{ p: Proveedor | null; error: string }>({ p: null, error: '' })
  useEffect(() => { if (org) getProveedor(org).then(p => setProv({ p, error: '' })).catch(e => setProv({ p: null, error: e instanceof Error ? e.message : 'No se pudo consultar el proveedor.' })) }, [org])
  const esAptus = prov.p?.proveedor === 'aptus'

  // ── Lista ──
  const [f, setF] = useState({ tipo: '', estado: '', origen: '' })
  const [texto, setTexto] = useState(() => params.get('invoice_number') || '')
  const [lista, setLista] = useState<Cfdi[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const load = async () => {
    if (!org) return
    setLoading(true); setError('')
    try { setLista(await getCfdis(org, f)) } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la lista.') } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [org, f]) // eslint-disable-line react-hooks/exhaustive-deps
  const filas = useMemo(() => (lista ?? []).filter(c => coincide(texto, c.invoice_number, c.uuid, c.receptor_rfc, serieFolio(c), c.payment_id))
    .sort((a, b) => (b.fecha_timbrado || b.creado_en || '').localeCompare(a.fecha_timbrado || a.creado_en || '') || b.id - a.id), [lista, texto])

  // ── Detalle ──
  const [selId, setSelId] = useState<number | null>(inicial)
  const [sel, setSel] = useState<{ c: Cfdi | null; loading: boolean; error: string }>({ c: null, loading: false, error: '' })
  const cargar = async (id: number) => {
    if (!org) return
    setSel(s => ({ c: s.c?.id === id ? s.c : null, loading: true, error: '' }))
    try { setSel({ c: await getCfdi(org, id), loading: false, error: '' }) } catch (e) { setSel({ c: null, loading: false, error: e instanceof Error ? e.message : 'No se pudo cargar el CFDI.' }) }
  }
  useEffect(() => { if (selId) void cargar(selId) }, [selId]) // eslint-disable-line react-hooks/exhaustive-deps
  const detalleRef = useRef<HTMLDivElement>(null)
  const elegir = (c: Cfdi) => { setSelId(c.id); setTimeout(() => detalleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }

  const [busy, setBusy] = useState('')
  const consultarSat = async () => {
    if (!org || !sel.c) return
    setBusy('estatus')
    try {
      const r = await getEstatus(org, sel.c.id)
      if (r.registro) setSel(s => ({ ...s, c: r.registro! }))
      const nota = typeof r.api?.nota === 'string' ? ` ${r.api.nota}` : ''
      toast.success(`Estatus: ${ESTADO_LABEL[(r.registro?.estado ?? sel.c.estado) as Estado]}.${nota}`)
      void load()
    } catch (e) { setModal({ isOpen: true, type: 'error', title: 'No se consultó el estatus', message: e instanceof Error ? e.message : 'Error.' }) }
    finally { setBusy('') }
  }

  // ── Cancelar ──
  const [cancelOpen, setCancelOpen] = useState(false)
  const [motivo, setMotivo] = useState('02')
  const [sustituto, setSustituto] = useState('')
  const [entiendo, setEntiendo] = useState(false)
  const errorCancel = validarCancelacion(motivo, sustituto)
  const abrirCancelar = () => { setMotivo('02'); setSustituto(''); setEntiendo(false); setCancelOpen(true) }
  const cancelar = async () => {
    if (!org || !sel.c || errorCancel || !entiendo || busy) return
    setBusy('cancelar')
    try {
      const r = await cancelarCfdi(org, sel.c.id, motivo, sustituto.trim())
      setCancelOpen(false)
      if (r.en_proceso) setModal({ isOpen: true, type: 'info', title: 'Cancelación en curso', message: r.mensaje || 'El servicio sigue procesando la cancelación. Consulta el estatus en unos minutos.' })
      else toast.success('Cancelación solicitada.')
      await cargar(sel.c.id); void load()
    } catch (e) {
      const incierto = (e as { uncertain?: boolean })?.uncertain
      setModal({ isOpen: true, type: 'error', title: incierto ? 'Resultado por verificar' : 'No se canceló', message: e instanceof Error ? e.message : 'Error.' })
    } finally { setBusy('') }
  }

  const c = sel.c
  const cancelable = !!c && esAptus && c.origen === 'aptus' && c.estado === 'vigente' && !!c.uuid
  return (
    <div className="min-h-screen bg-slate-50/50 p-2 sm:p-4 lg:p-8 flex justify-center items-start font-sans w-full">
      <Toaster position="top-center" richColors />
      <Card className="w-full bg-gradient-to-b from-[#F3F9FD] to-white border border-slate-200 rounded-[20px] overflow-hidden p-3 sm:p-5 lg:p-8 relative animate__animated animate__fadeIn animate__faster">
        <div className="absolute top-0 left-0 right-0 h-15 bg-gradient-to-b from-theme-light to-transparent pointer-events-none z-0"></div>
        <Encabezado icon={FileText} titulo="CFDI emitidos" subtitulo="Facturas y complementos timbrados: archivos, estatus ante el SAT y cancelación" theme={theme} setTheme={setTheme}
          acciones={<Button variant="outline" onClick={() => void load()} disabled={loading} className="flex-1 lg:flex-none h-11 px-4 rounded-lg border-slate-200 text-slate-700 gap-2"><RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />Actualizar</Button>} />
        <NavCfdi actual="emitidos" />
        <AvisoProveedor p={prov.p} error={prov.error} />

        <div className="relative z-10 grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-4 items-start">
          <section className="border border-slate-200 rounded-xl bg-white p-3 sm:p-4 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <select className={selectCls} value={f.tipo} onChange={e => setF(x => ({ ...x, tipo: e.target.value }))} aria-label="Tipo">
                <option value="">Todos los tipos</option><option value="I">Ingreso</option><option value="E">Egreso</option><option value="P">Complemento de pago</option>
              </select>
              <select className={selectCls} value={f.estado} onChange={e => setF(x => ({ ...x, estado: e.target.value }))} aria-label="Estado">
                <option value="">Todos los estados</option>{(Object.keys(ESTADO_LABEL) as Estado[]).map(e => <option key={e} value={e}>{ESTADO_LABEL[e]}</option>)}
              </select>
              <select className={selectCls} value={f.origen} onChange={e => setF(x => ({ ...x, origen: e.target.value }))} aria-label="Origen">
                <option value="">Timbrados y registrados</option><option value="aptus">Timbrados en Aptus</option><option value="interno">Registro manual</option>
              </select>
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input className={cn(inputCls, 'pl-8 pr-8')} placeholder="Factura, UUID, RFC o serie-folio" value={texto} onChange={e => setTexto(e.target.value)} aria-label="Buscar" />
                {texto && <button type="button" aria-label="Borrar búsqueda" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setTexto('')}><X className="w-4 h-4" /></button>}
              </div>
            </div>
            {error && <p role="alert" className="text-xs text-red-700 mb-2">{error}</p>}
            {loading && !lista ? <p className="text-xs text-slate-500">Cargando…</p> : !filas.length ? <p className="text-sm text-slate-500">No hay CFDI con estos filtros.</p> : (
              <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="sticky top-0 bg-white"><tr className="border-b border-slate-200"><th className={th}>Serie-folio</th><th className={th}>Factura / pago</th><th className={th}>Receptor</th><th className={cn(th, 'text-right')}>Total</th><th className={th}>Estado</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {filas.map(x => (
                      <tr key={x.id} onClick={() => elegir(x)} className={cn('cursor-pointer align-top hover:bg-theme-light/50', selId === x.id && 'bg-theme-light')}>
                        <td className="py-2 pr-3 whitespace-nowrap"><button type="button" className="font-semibold text-slate-800 hover:underline" onClick={e => { e.stopPropagation(); elegir(x) }}>{serieFolio(x)}</button>
                          <span className="block text-[10px] text-slate-500">{TIPO_LABEL[x.tipo] ?? x.tipo} · {formatFecha(x.fecha_timbrado || x.fecha)}</span></td>
                        <td className="py-2 pr-3">{x.invoice_number || '—'}{x.tipo === 'P' && x.payment_id && <span className="block text-[10px] text-slate-500">Pago {x.payment_id.slice(-6)}</span>}</td>
                        <td className="py-2 pr-3 font-mono text-[11px]">{x.receptor_rfc || '—'}</td>
                        <td className={cn(num, 'py-2 pr-3')}>{x.tipo === 'P' ? <span className="text-slate-400">—</span> : formatMoney(x.total, x.moneda)}</td>
                        <td className="py-2"><EstadoBadge e={x.estado} prueba={x.prueba} />{x.origen === 'interno' && <span className="block text-[10px] text-slate-500">registro manual</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section ref={detalleRef} className="border border-slate-200 rounded-xl bg-white p-3 sm:p-4 min-w-0">
            {!selId ? <p className="text-sm text-slate-500 flex items-center gap-1.5"><Info className="w-4 h-4" />Elige un CFDI para ver su detalle.</p>
              : sel.loading && !c ? <p role="status" className="text-sm text-slate-600 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-theme-text" />Cargando…</p>
              : sel.error ? <p role="alert" className="text-sm text-red-700">{sel.error}</p>
              : c && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">{serieFolio(c)} <span className="text-sm font-normal text-slate-500">{TIPO_LABEL[c.tipo] ?? c.tipo}</span></h2>
                      <p className="font-mono text-[11px] text-slate-600 break-all">{c.uuid || 'sin UUID'}</p>
                    </div>
                    <EstadoBadge e={c.estado} prueba={c.prueba} />
                  </div>
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
                    {([['Factura', c.invoice_number], ['Receptor', c.receptor_rfc], ['Total', c.tipo === 'P' ? '—' : formatMoney(c.total, c.moneda)], ['Método / forma', [c.metodo_pago, c.forma_pago].filter(Boolean).join(' · ') || '—'],
                      ['Timbrado', formatFecha(c.fecha_timbrado)], ['Emisor', c.emisor], ['Estatus SAT', c.status_sat || '—'], ['Última consulta', formatFecha(c.ultima_consulta)], ['Prebill', c.prebill_id ? `#${c.prebill_id}` : '—']] as const).map(([l, v]) => (
                      <div key={l} className="min-w-0"><dt className="text-[10px] text-slate-500">{l}</dt><dd className="truncate">{v || '—'}</dd></div>
                    ))}
                  </dl>
                  {c.motivo_cancelacion && <p className="text-xs text-slate-600">Cancelación solicitada {formatFecha(c.cancelacion_solicitada_en)} · motivo {c.motivo_cancelacion}{c.sustituto ? ` · sustituto ${c.sustituto}` : ''}</p>}
                  {c.estado === 'cancelacion_en_proceso' && <p className="text-xs rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-900">Esperando que el receptor acepte la cancelación (hasta 3 días hábiles). Mientras tanto el CFDI sigue vigente.{c.prueba ? ' En modo prueba nunca se resuelve.' : ''}</p>}
                  {c.error && <p role="alert" className="text-xs text-red-700">{c.error}</p>}
                  {!!c.impuestos?.length && <p className="text-xs text-slate-600">Impuestos: {c.impuestos.map(i => `IVA ${Math.round(i.tasa * 100)}% sobre ${formatMoney(i.base)} = ${formatMoney(i.importe)}`).join(' · ')}</p>}
                  {!!c.monto_excluido && <p className="text-xs text-slate-500">Fuera del CFDI (reembolsos): {formatMoney(c.monto_excluido, c.moneda)}</p>}
                  {c.tipo === 'P' && !!c.documentos?.length && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[460px] text-xs">
                        <thead><tr className="border-b border-slate-200"><th className={th}>Factura pagada</th><th className={cn(th, 'text-right')}>Parcialidad</th><th className={cn(th, 'text-right')}>Saldo anterior</th><th className={cn(th, 'text-right')}>Pagado</th><th className={cn(th, 'text-right')}>Saldo</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">{c.documentos.map(dd => (
                          <tr key={dd.invoice_id}><td className="py-1.5 pr-3">{dd.invoice_number}<span className="block font-mono text-[10px] text-slate-500">{dd.uuid}</span></td><td className={cn(num, 'pr-3')}>{dd.num_parcialidad}</td><td className={cn(num, 'pr-3')}>{formatMoney(dd.saldo_anterior)}</td><td className={cn(num, 'pr-3')}>{formatMoney(dd.importe_pagado)}</td><td className={num}>{formatMoney(dd.saldo_insoluto)}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                  {org && c.uuid && <Archivos org={org} c={c} />}
                  <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
                    {c.origen === 'aptus' && c.uuid && esAptus && (
                      <Button variant="outline" className="h-10 gap-1.5 border-slate-200" disabled={!!busy} onClick={() => void consultarSat()}>
                        {busy === 'estatus' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}Consultar estatus SAT
                      </Button>
                    )}
                    {cancelable && <Button variant="outline" className="h-10 gap-1.5 border-red-200 text-red-700 hover:bg-red-50" disabled={!!busy} onClick={abrirCancelar}><Ban className="w-4 h-4" />Cancelar CFDI</Button>}
                  </div>
                </div>
              )}
          </section>
        </div>
        <p className="mt-4 text-[11px] text-slate-500 relative z-10">El estatus final de una cancelación lo da el SAT. Desde aquí no se escribe en Books.</p>
      </Card>

      <Dialog open={cancelOpen} onOpenChange={v => { if (!busy) setCancelOpen(v) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Ban className="w-5 h-5 text-red-600" />Cancelar {c ? serieFolio(c) : ''}</DialogTitle>
            <DialogDescription>Se pide la cancelación al SAT. Si el receptor tiene que aceptarla, queda "en proceso" hasta que responda.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div role="radiogroup" aria-label="Motivo" className="grid gap-2">
              {MOTIVOS.map(m => (
                <button key={m.id} type="button" role="radio" aria-checked={motivo === m.id} onClick={() => setMotivo(m.id)}
                  className={cn('text-left rounded-lg border px-3 py-2', motivo === m.id ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:bg-slate-50')}>
                  <span className="block text-sm font-semibold text-slate-800">{m.label}</span><span className="block text-[11px] text-slate-500">{m.desc}</span>
                </button>
              ))}
            </div>
            {motivo === '01' && (
              <label className="block space-y-1"><span className={labelCls}>UUID del CFDI que lo sustituye</span>
                <Input className={cn(inputCls, 'font-mono text-xs')} placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" value={sustituto} onChange={e => setSustituto(e.target.value)} /></label>
            )}
            <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" className="mt-0.5" checked={entiendo} onChange={e => setEntiendo(e.target.checked)} />
              Entiendo que la cancelación no se puede deshacer.{c?.prueba ? ' (Modo prueba: no llega al SAT.)' : ''}</label>
            {errorCancel && motivo === '01' && sustituto && <p role="alert" className="text-xs text-red-700">{errorCancel}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="h-10 border-slate-200" disabled={!!busy} onClick={() => setCancelOpen(false)}>No cancelar</Button>
              <Button className="h-10 gap-1.5 bg-red-600 hover:bg-red-700 text-white" disabled={!!errorCancel || !entiendo || !!busy} onClick={() => void cancelar()}>
                {busy === 'cancelar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}Cancelar CFDI
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <StatusModal isOpen={modal.isOpen} onClose={!org ? undefined : () => setModal(m => ({ ...m, isOpen: false }))} type={modal.type} title={modal.title} message={modal.message} />
    </div>
  )
}

export default App
