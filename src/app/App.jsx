import React, { useEffect, useMemo, useState } from 'react'
import { QRButton } from './QRButton.jsx'

// Person: { id, name, phone? }
// Expense: { id, label, amount, currency, payerId, participants: string[], splitMode: 'equal'|'weights', weights?: Record<personId, number> }
// DirectDebt: { id, fromId, toId, amount, currency }
// Ledger: { id, name, baseCurrency, fx: Record<code,rate>, decimals, people: Person[], expenses: Expense[], directDebts: DirectDebt[] }

const uid = () => Math.random().toString(36).slice(2, 10)
const clamp2 = (n) => (Math.abs(n) < 1e-9 ? 0 : n)

const CURRENCY_SYMBOLS = { COP: '$', USD: '$', EUR: '€', MXN: '$', BRL: 'R$', GBP: '£' }
const fmt = (n, code, decimals) => `${(CURRENCY_SYMBOLS[code] ?? code+' ')}${Number(n).toFixed(decimals)} ${code}`

const t = (lang, key, vars={}) => {
  const dict = {
    en: {
      title: 'Splitwise-Lite',
      subtitle: 'Multi-currency bill splitter with minimal-transactions settlement.',
      base: 'Base', decimals: 'Decimals', export: 'Export JSON', import: 'Import JSON',
      fxTitle: 'FX to Base (rate = 1 unit in base)',
      addCurrency: '+ Add currency', remove: 'Remove', cannotRemoveBase: 'Cannot remove base',
      fxHint: 'Example: if base is COP and USD rate is 4000, then 1 USD = 4000 COP.',
      people: 'People', addPerson: '+ Add person', phone: 'Phone',
      placeholderName: 'Insert name here',
      expenses: 'Expenses', addExpense: '+ Add expense',
      eqSplit: 'equal split', uneqSplit: 'unequal (weights)', share: 'share', among: 'among',
      debts: 'Direct Debts (A owes B)', addDebt: '+ Add debt',
      results: 'Results',
      netsTitle: (bc) => `Net balances (in ${bc}) — + receive / – pay`,
      settleTitle: (bc) => `Minimal transactions (in ${bc})`,
      allSettled: 'All settled 🎉',
      owes: 'owes', to: 'to',
      nequi: 'Nequi', daviplata: 'DaviPlata', whatsapp: 'WhatsApp',
      lang: 'Language', ledger: 'Ledger', addLedger: '+ New ledger', duplicate: 'Duplicate', rename: 'Rename', delete: 'Delete',
      askPhone: 'Add a phone number for this person in People to enable WhatsApp links.',
      theme: 'Theme',
    },
    es: {
      title: 'Splitwise-Lite',
      subtitle: 'Divisor de gastos multicurrency con liquidación de transacciones mínimas.',
      base: 'Base', decimals: 'Decimales', export: 'Exportar JSON', import: 'Importar JSON',
      fxTitle: 'FX a Base (tasa = 1 unidad en base)',
      addCurrency: '+ Agregar moneda', remove: 'Eliminar', cannotRemoveBase: 'No se puede eliminar la base',
      fxHint: 'Ejemplo: si la base es COP y USD=4000, entonces 1 USD = 4000 COP.',
      people: 'Personas', addPerson: '+ Agregar persona', phone: 'Celular',
      placeholderName: 'Insertar nombre aquí',
      expenses: 'Gastos', addExpense: '+ Agregar gasto',
      eqSplit: 'división igual', uneqSplit: 'desigual (pesos)', share: 'cuota', among: 'entre',
      debts: 'Deudas directas (A le debe a B)', addDebt: '+ Agregar deuda',
      results: 'Resultados',
      netsTitle: (bc) => `Saldos netos (en ${bc}) — + recibe / – paga`,
      settleTitle: (bc) => `Transacciones mínimas (en ${bc})`,
      allSettled: 'Todo saldado 🎉',
      owes: 'debe', to: 'a',
      nequi: 'Nequi', daviplata: 'DaviPlata', whatsapp: 'WhatsApp',
      lang: 'Idioma', ledger: 'Fondo', addLedger: '+ Nuevo fondo', duplicate: 'Duplicar', rename: 'Renombrar', delete: 'Eliminar',
      askPhone: 'Agrega un número de celular a esta persona en Personas para habilitar WhatsApp.',
      theme: 'Tema',
    }
  }
  const d = dict[lang] || dict.en
  const val = d[key]
  if (typeof val === 'function') return val(vars)
  if (val == null) return key
  return val
}

// Minimal cashflow (greedy) on net balances
function simplifyBalances(balances, decimals) {
  const eps = 1 / 10 ** decimals
  const entries = Object.entries(balances).map(([id, v]) => ({ id, v }))
  const pay = []
  const arr = entries.map((e) => ({ ...e }))

  const maxCredIdx = () => arr.reduce((best, cur, i) => (cur.v > arr[best].v ? i : best), 0)
  const maxDebtIdx = () => arr.reduce((best, cur, i) => (cur.v < arr[best].v ? i : best), 0)

  let guard = 0
  while (guard++ < 10000) {
    const ci = maxCredIdx()
    const di = maxDebtIdx()
    const c = arr[ci]
    const d = arr[di]
    if (c.v <= eps && d.v >= -eps) break
    const amt = Math.min(c.v, -d.v)
    if (amt <= eps) break
    pay.push({ fromId: d.id, toId: c.id, amount: clamp2(amt) })
    c.v = clamp2(c.v - amt)
    d.v = clamp2(d.v + amt)
  }
  return pay
}

// Convert amount to base using fx[code] = base per 1 code
const toBase = (amount, code, fx) => {
  const r = fx[code]
  if (!r || r <= 0) return amount // if not set, treat as base
  return amount * r
}

function computeBalances(people, expenses, directDebts, fx) {
  const net = Object.fromEntries(people.map((p) => [p.id, 0]))

  for (const e of expenses) {
    if (!e.participants?.length || e.amount <= 0) continue
    let shares = {}
    if (e.splitMode === 'weights' && e.weights) {
      const sumW = e.participants.reduce((s, pid) => s + (Number(e.weights[pid]) || 0), 0)
      for (const pid of e.participants) {
        const w = Number(e.weights[pid]) || 0
        const share = sumW > 0 ? (e.amount * (w / sumW)) : 0
        shares[pid] = toBase(share, e.currency, fx)
      }
    } else {
      const shareBase = toBase(e.amount / e.participants.length, e.currency, fx)
      for (const pid of e.participants) shares[pid] = shareBase
    }
    const amtBase = toBase(e.amount, e.currency, fx)
    net[e.payerId] = (net[e.payerId] ?? 0) + amtBase
    for (const pid of e.participants) net[pid] = (net[pid] ?? 0) - shares[pid]
  }

  for (const d of directDebts) {
    if (d.amount <= 0) continue
    const amtBase = toBase(d.amount, d.currency, fx)
    net[d.fromId] = (net[d.fromId] ?? 0) - amtBase
    net[d.toId] = (net[d.toId] ?? 0) + amtBase
  }
  const sum = Object.values(net).reduce((a, b) => a + b, 0)
  if (Math.abs(sum) > 1e-6) {
    const first = people[0]?.id
    if (first) net[first] -= sum
  }
  return net
}

// Open Android app (best-effort) or fallback to store
const openAndroidApp = (pkg, storeUrl) => {
  try {
    const intent = `intent://splitwise-lite/#Intent;package=${pkg};scheme=app;end`
    window.location.href = intent
    setTimeout(() => { window.location.href = storeUrl }, 800)
  } catch {
    window.location.href = storeUrl
  }
}

export default function App() {
  // ---- Language & Theme ----
  const [lang, setLang] = useState('es') // default Spanish
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
    localStorage.setItem('theme', theme)
  }, [theme])

  // ---- Ledgers ----
  const initialPeople = [
    { id: uid(), name: t('es','placeholderName'), phone: '' },
    { id: uid(), name: t('es','placeholderName'), phone: '' },
    { id: uid(), name: t('es','placeholderName'), phone: '' },
  ]
  const [ledgers, setLedgers] = useState(() => {
    const raw = localStorage.getItem('splitwise-lite-ledgers')
    if (raw) { try { const data = JSON.parse(raw); if (Array.isArray(data) && data.length) return data } catch {} }
    const id = uid()
    return [{
      id, name: 'Ledger 1', baseCurrency: 'COP', decimals: 0,
      // start everything at 0 (user can set rates)
      fx: { COP: 0, USD: 0, EUR: 0 },
      people: initialPeople,
      expenses: [], directDebts: []
    }]
  })
  const [lid, setLid] = useState(ledgers[0].id)
  const ledger = useMemo(() => ledgers.find(l => l.id === lid) || ledgers[0], [ledgers, lid])

  useEffect(() => {
    localStorage.setItem('splitwise-lite-ledgers', JSON.stringify(ledgers))
  }, [ledgers])

  const updateLedger = (patch) => setLedgers((arr) => arr.map(l => l.id === ledger.id ? { ...l, ...patch } : l))

  // ---- Derived ----
  const balances = useMemo(() => computeBalances(ledger?.people ?? [], ledger?.expenses ?? [], ledger?.directDebts ?? [], ledger?.fx ?? { COP:1 }), [ledger])
  const settlements = useMemo(() => simplifyBalances(balances, ledger?.decimals ?? 0), [balances, ledger?.decimals])
  const currencyOptions = Object.keys(ledger?.fx ?? {})
  const nameOf = (id) => ledger?.people.find((p) => p.id === id)?.name ?? '?'
  const phoneOf = (id) => ledger?.people.find((p) => p.id === id)?.phone?.replace(/\D/g,'') || ''

  // ---- Ledger mgmt ----
  const addLedger = () => {
    const id = uid()
    setLedgers((arr) => [...arr, {
      id, name: `Ledger ${arr.length + 1}`, baseCurrency: ledger.baseCurrency, decimals: ledger.decimals,
      fx: { ...ledger.fx }, people: [
        { id: uid(), name: t(lang,'placeholderName'), phone: '' },
        { id: uid(), name: t(lang,'placeholderName'), phone: '' },
        { id: uid(), name: t(lang,'placeholderName'), phone: '' },
      ], expenses: [], directDebts: []
    }])
    setLid(id)
  }
  const duplicateLedger = () => {
    const id = uid()
    const copy = JSON.parse(JSON.stringify(ledger))
    copy.id = id
    copy.name = ledger.name + ' (copy)'
    setLedgers((arr) => [...arr, copy])
    setLid(id)
  }
  const deleteLedger = () => {
    if (ledgers.length <= 1) {
      alert('You cannot delete the only ledger.')
      return
    }
    if (!confirm('Delete this ledger?')) return
    const idx = ledgers.findIndex(l => l.id === ledger.id)
    const arr = ledgers.filter(l => l.id !== ledger.id)
    setLedgers(arr)
    const fallbackId = arr[Math.min(idx, arr.length - 1)]?.id
    if (fallbackId) setLid(fallbackId)
  }
  const renameLedger = () => {
    const nn = prompt('New name', ledger.name)
    if (!nn) return
    updateLedger({ name: nn })
  }

  // ---- People ----
  const addPerson = () => updateLedger({ people: [...ledger.people, { id: uid(), name: t(lang,'placeholderName'), phone: '' }] })
  const removePerson = (id) => {
    const people = ledger.people.filter(p => p.id !== id)
    const expenses = ledger.expenses
      .map(ex => ({ ...ex, participants: ex.participants.filter(pid => pid !== id) }))
      .filter(ex => ex.payerId !== id)
    const directDebts = ledger.directDebts.filter(d => d.fromId !== id && d.toId !== id)
    updateLedger({ people, expenses, directDebts })
  }

  // ---- FX ----
  const setFxFor = (code, val) => updateLedger({ fx: { ...ledger.fx, [code]: val } })
  const addCurrency = () => {
    const code = prompt('New currency code (e.g., ARS)')?.trim().toUpperCase()
    if (!code) return
    if (ledger.fx[code]) return
    updateLedger({ fx: { ...ledger.fx, [code]: 0 } })
  }
  const removeCurrency = (code) => {
    if (code === ledger.baseCurrency) return alert(t(lang,'cannotRemoveBase'))
    const fx = { ...ledger.fx }; delete fx[code]
    updateLedger({ fx })
  }

  // ---- Expenses ----
  const addExpense = () => {
    const first = ledger.people[0]?.id ?? ''
    updateLedger({ expenses: [...ledger.expenses, {
      id: uid(), label: 'Expense', amount: 0, currency: ledger.baseCurrency, payerId: first,
      participants: ledger.people.map(p => p.id), splitMode: 'equal', weights: Object.fromEntries(ledger.people.map(p => [p.id, 1]))
    }] })
  }
  const removeExpense = (id) => updateLedger({ expenses: ledger.expenses.filter(x => x.id !== id) })

  // ---- Debts ----
  const addDebt = () => {
    const a = ledger.people[0]?.id ?? ''
    const b = ledger.people[1]?.id ?? ''
    updateLedger({ directDebts: [...ledger.directDebts, { id: uid(), fromId: a, toId: b, amount: 0, currency: ledger.baseCurrency }] })
  }
  const removeDebt = (id) => updateLedger({ directDebts: ledger.directDebts.filter(x => x.id !== id) })

  // ---- Import/Export ----
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(ledgers, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'splitwise-lite-ledgers.json'; a.click()
    URL.revokeObjectURL(url)
  }
  const importJSON = (file) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        if (Array.isArray(data) && data.length) {
          setLedgers(data)
          setLid(data[0].id)
        } else {
          alert('Invalid JSON: no ledgers found.')
        }
      } catch { alert('Invalid JSON') }
    }
    reader.readAsText(file)
  }

// ---- Payment helpers (WhatsApp only; send to the person who OWES) ----
const waLink = (phone, text) => phone ? `https://wa.me/57${phone}?text=${encodeURIComponent(text)}` : null

const payButtons = (fromId, toId, amountBase) => {
  // fromId = debtor, toId = collector
  const debtor = nameOf(fromId)
  const collector = nameOf(toId)
  const debtorPhone = phoneOf(fromId) // now sends to the person who owes
  const msg = `${debtor} owes ${collector}: ${amountBase.toFixed(ledger.decimals)} ${ledger.baseCurrency} (Splitwise-Lite)`
  const wa = waLink(debtorPhone, msg)

  return (
    <div className="flex gap-2 items-center">
      {wa ? (
        <QRButton label={t(lang,'whatsapp')} href={wa} />
      ) : (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {t(lang,'askPhone')}
        </span>
      )}
    </div>
  )
}


  if (!ledger) return <div className="p-6 text-center">No ledger. Create one to begin.</div>

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top bar */}
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{t(lang,'title')}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">{t(lang,'subtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            {/* Theme */}
            <label className="text-sm flex items-center gap-2">
              <span>{t(lang,'theme')}</span>
              <select
                className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>

            {/* Language */}
            <label className="text-sm flex items-center gap-2">
              <span>{t(lang,'lang')}</span>
              <select className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800" value={lang} onChange={(e) => setLang(e.target.value)}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </label>

            {/* Ledger select & actions */}
            <label className="text-sm flex items-center gap-2">
              <span>{t(lang,'ledger')}</span>
              <select className="px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800" value={ledger.id} onChange={(e) => setLid(e.target.value)}>
                {ledgers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <button className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm shadow" onClick={addLedger}>{t(lang,'addLedger')}</button>
            <button className="px-3 py-1.5 rounded bg-slate-800 dark:bg-slate-700 hover:brightness-110 text-white text-sm" onClick={duplicateLedger}>{t(lang,'duplicate')}</button>
            <button className="px-3 py-1.5 rounded bg-slate-800 dark:bg-slate-700 hover:brightness-110 text-white text-sm" onClick={renameLedger}>{t(lang,'rename')}</button>
            <button className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-sm" onClick={deleteLedger}>{t(lang,'delete')}</button>
            <button className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm" onClick={exportJSON}>{t(lang,'export')}</button>
            <label className="px-3 py-1.5 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-sm shadow cursor-pointer">
              {t(lang,'import')}
              <input type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJSON(f); }} />
            </label>
          </div>
        </header>

        {/* Settings */}
        <section className="bg-white dark:bg-slate-800 rounded-2xl shadow p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span>{t(lang,'base')}</span>
              <select className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" value={ledger.baseCurrency} onChange={(e) => updateLedger({ baseCurrency: e.target.value })}>
                {Object.keys(ledger.fx).map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span>{t(lang,'decimals')}</span>
              <select className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" value={ledger.decimals} onChange={(e) => updateLedger({ decimals: parseInt(e.target.value) })}>
                {[0,1,2].map((d) => (<option key={d} value={d}>{d}</option>))}
              </select>
            </label>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">{t(lang,'fxTitle')}</h2>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm shadow" onClick={addCurrency}>{t(lang,'addCurrency')}</button>
              </div>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              {Object.entries(ledger.fx).map(([code, rate]) => (
                <div key={code} className="border border-slate-300 dark:border-slate-700 rounded-xl p-3 flex items-center gap-2 bg-white dark:bg-slate-900">
                  <span className="font-mono w-16">{code}</span>
                  <input type="number" step="0.0001" className="flex-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" value={rate} onChange={(e) => setFxFor(code, Number(e.target.value))} />
                  <button className="text-sm px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white" onClick={() => removeCurrency(code)} disabled={code === ledger.baseCurrency} title={code === ledger.baseCurrency ? t(lang,'cannotRemoveBase') : t(lang,'remove')}>×</button>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">{t(lang,'fxHint')}</p>
          </div>
        </section>

        {/* People */}
        <section className="bg-white dark:bg-slate-800 rounded-2xl shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">{t(lang,'people')}</h2>
            <button className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm shadow" onClick={addPerson}>{t(lang,'addPerson')}</button>
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            {ledger.people.map((p) => (
              <div key={p.id} className="border border-slate-300 dark:border-slate-700 rounded-xl p-3 space-y-2 bg-white dark:bg-slate-900">
                <div className="flex items-center gap-2">
                  <input className="flex-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 placeholder-slate-400 dark:placeholder-slate-500"
                         placeholder={t(lang,'placeholderName')}
                         value={p.name}
                         onChange={(e) => updateLedger({ people: ledger.people.map(x => x.id===p.id? {...x, name: e.target.value } : x) })} />
                  <button className="text-sm px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white" onClick={() => removePerson(p.id)} disabled={ledger.people.length <= 2}>×</button>
                </div>
                <input className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                       placeholder={t(lang,'phone')}
                       value={p.phone||''}
                       onChange={(e) => updateLedger({ people: ledger.people.map(x => x.id===p.id? {...x, phone: e.target.value } : x) })} />
              </div>
            ))}
          </div>
        </section>

        {/* Expenses */}
        <section className="bg-white dark:bg-slate-800 rounded-2xl shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">{t(lang,'expenses')}</h2>
            <div className="flex gap-2">
              <button className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm shadow" onClick={addExpense}>{t(lang,'addExpense')}</button>
            </div>
          </div>
          <div className="space-y-3">
            {ledger.expenses.map((e) => (
              <div key={e.id} className="border border-slate-300 dark:border-slate-700 rounded-xl p-3 space-y-2 bg-white dark:bg-slate-900">
                <div className="grid md:grid-cols-8 gap-2 items-center">
                  <input className="md:col-span-2 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" placeholder="Label" value={e.label} onChange={(ev) => updateLedger({ expenses: ledger.expenses.map(x => x.id===e.id? {...x, label: ev.target.value } : x) })} />
                  <input type="number" step="0.01" className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" placeholder="Amount" value={e.amount} onChange={(ev) => updateLedger({ expenses: ledger.expenses.map(x => x.id===e.id? {...x, amount: Number(ev.target.value) } : x) })} />
                  <select className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" value={e.currency} onChange={(ev) => updateLedger({ expenses: ledger.expenses.map(x => x.id===e.id? {...x, currency: ev.target.value } : x) })}>
                    {currencyOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                  <select className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" value={e.payerId} onChange={(ev) => updateLedger({ expenses: ledger.expenses.map(x => x.id===e.id? {...x, payerId: ev.target.value } : x) })}>
                    {ledger.people.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                  </select>
                  <div className="md:col-span-2 flex flex-wrap gap-2">
                    {ledger.people.map((p) => {
                      const on = e.participants.includes(p.id)
                      return (
                        <label key={p.id} className={`text-sm px-2 py-1 rounded border cursor-pointer ${on ? 'bg-emerald-600/10 dark:bg-emerald-500/10 border-emerald-400 dark:border-emerald-500 text-emerald-700 dark:text-emerald-300' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700'}`}>
                          <input type="checkbox" className="mr-1" checked={on} onChange={(ev) => updateLedger({ expenses: ledger.expenses.map(x => x.id!==e.id ? x : { ...x, participants: ev.target.checked ? [...new Set([...x.participants, p.id])] : x.participants.filter(pid => pid !== p.id) }) })} />
                          {p.name}
                        </label>
                      )
                    })}
                  </div>
                  <button className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-sm" onClick={() => removeExpense(e.id)}>{t(lang,'remove')}</button>
                </div>

                {/* Split mode */}
                <div className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`split-${e.id}`} checked={e.splitMode!=='weights'} onChange={() => updateLedger({ expenses: ledger.expenses.map(x => x.id===e.id? {...x, splitMode:'equal'} : x) })} />
                    {t(lang, 'eqSplit')}
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`split-${e.id}`} checked={e.splitMode==='weights'} onChange={() => updateLedger({ expenses: ledger.expenses.map(x => x.id===e.id? {...x, splitMode:'weights', weights: x.weights||Object.fromEntries(ledger.people.map(p => [p.id, 1])) } : x) })} />
                    {t(lang, 'uneqSplit')}
                  </label>
                </div>

                {e.splitMode==='weights' && (
                  <div className="grid md:grid-cols-3 gap-2 text-sm">
                    {ledger.people.filter(p => e.participants.includes(p.id)).map(p => (
                      <label key={p.id} className="flex items-center justify-between border border-slate-300 dark:border-slate-700 rounded-xl p-2 bg-white dark:bg-slate-800">
                        <span>{p.name}</span>
                        <input type="number" step="0.01" className="w-24 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                          value={Number(e.weights?.[p.id]||0)}
                          onChange={(ev) => updateLedger({ expenses: ledger.expenses.map(x => x.id===e.id? { ...x, weights: { ...(x.weights||{}), [p.id]: Number(ev.target.value) } } : x) })} />
                      </label>
                    ))}
                  </div>
                )}

                <div className="text-xs text-slate-600 dark:text-slate-400">
                  {e.participants.length > 0 && (
                    <span>
                      {t(lang,'share')} {fmt(e.amount, e.currency, ledger.decimals)} {t(lang,'among')} {e.participants.length} {e.splitMode==='weights' ? '(weights applied)' : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {ledger.expenses.length === 0 && (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No expenses yet. Click “{t(lang,'addExpense')}”.
              </p>
            )}
          </div>
        </section>

        {/* Direct Debts */}
        <section className="bg-white dark:bg-slate-800 rounded-2xl shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">{t(lang,'debts')}</h2>
            <button className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-sm shadow" onClick={addDebt}>{t(lang,'addDebt')}</button>
          </div>
          <div className="space-y-3">
            {ledger.directDebts.map((d) => (
              <div key={d.id} className="border border-slate-300 dark:border-slate-700 rounded-xl p-3 grid md:grid-cols-7 gap-2 items-center bg-white dark:bg-slate-900">
                <select className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" value={d.fromId} onChange={(ev) => updateLedger({ directDebts: ledger.directDebts.map(x => x.id===d.id? { ...x, fromId: ev.target.value } : x) })}>
                  {ledger.people.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </select>
                <span className="text-center">{t(lang,'owes')}</span>
                <select className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" value={d.toId} onChange={(ev) => updateLedger({ directDebts: ledger.directDebts.map(x => x.id===d.id? { ...x, toId: ev.target.value } : x) })}>
                  {ledger.people.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                </select>
                <span className="text-center">→</span>
                <input type="number" step="0.01" className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" value={d.amount} onChange={(ev) => updateLedger({ directDebts: ledger.directDebts.map(x => x.id===d.id? { ...x, amount: Number(ev.target.value) } : x) })} />
                <select className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" value={d.currency} onChange={(ev) => updateLedger({ directDebts: ledger.directDebts.map(x => x.id===d.id? { ...x, currency: ev.target.value } : x) })}>
                  {currencyOptions.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
                <button className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-sm" onClick={() => removeDebt(d.id)}>{t(lang,'remove')}</button>
              </div>
            ))}
            {ledger.directDebts.length === 0 && (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No direct debts yet. Click “{t(lang,'addDebt')}”.
              </p>
            )}
          </div>
        </section>

        {/* Results */}
        <section className="bg-white dark:bg-slate-800 rounded-2xl shadow p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t(lang,'results')}</h2>
          </div>

          {/* Net Balances */}
          <div>
            <h3 className="text-sm font-semibold mb-2">{t(lang,'netsTitle', { bc: ledger.baseCurrency })}</h3>
            <div className="grid md:grid-cols-3 gap-3">
              {ledger.people.map((p) => (
                <div key={p.id} className="border border-slate-300 dark:border-slate-700 rounded-xl p-3 flex items-center justify-between bg-white dark:bg-slate-900">
                  <span>{p.name}</span>
                  <span className={balances[p.id] >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {fmt(balances[p.id] || 0, ledger.baseCurrency, ledger.decimals)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Settlement */}
          <div>
            <h3 className="text-sm font-semibold mb-2">{t(lang,'settleTitle', { bc: ledger.baseCurrency })}</h3>
            {settlements.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">{t(lang,'allSettled')}</p>
            ) : (
              <ul className="space-y-2">
                {settlements.map((s, i) => (
                  <li key={i} className="border border-slate-300 dark:border-slate-700 rounded-xl p-3 grid md:grid-cols-2 gap-2 items-center justify-between bg-white dark:bg-slate-900">
                    <span>
                      <strong>{nameOf(s.fromId)}</strong> → <strong>{nameOf(s.toId)}</strong>
                    </span>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{fmt(s.amount, ledger.baseCurrency, ledger.decimals)}</span>
                      {payButtons(s.fromId, s.toId, s.amount)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
