import React, { useMemo, useState } from 'react'
import QRCode from 'qrcode'

export function QRButton({ label='QR', href }) {
  const [open, setOpen] = useState(false)
  const [dataUrl, setDataUrl] = useState(null)

  const generate = async () => {
    try {
      const url = await QRCode.toDataURL(href || '')
      setDataUrl(url)
    } catch { setDataUrl(null) }
  }

  return (
    <div className="relative">
      <button
        className="text-xs px-2 py-1 rounded bg-emerald-600 text-white"
        onClick={async () => { await generate(); setOpen((o) => !o) }}
        title={href}
      >
        {label}
      </button>
      {open && (
        <div className="absolute z-10 mt-2 p-3 bg-white border rounded-xl shadow">
          {dataUrl ? <img src={dataUrl} alt="QR" className="w-40 h-40" /> : <p className="text-xs text-slate-500">No QR</p>}
          <div className="mt-2 flex gap-2">
            <a className="text-xs px-2 py-1 rounded bg-slate-800 text-white" href={href} target="_blank" rel="noreferrer">Open</a>
            <button className="text-xs px-2 py-1 rounded bg-slate-200" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
