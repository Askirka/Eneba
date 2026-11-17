import { useState } from 'react'

export function Cover({ product }: { product: { id: string; title: string } }) {
  const [failed, setFailed] = useState(false)
  return <span className="cover" aria-hidden="true"><span>{product.title}</span>
    {!failed && <img src={'/covers/' + product.id + '.jpg'} alt="" loading="lazy" onError={() => setFailed(true)} />}
  </span>
}
