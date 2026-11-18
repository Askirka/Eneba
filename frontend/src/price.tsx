import { money } from './cart'

export function OfferPrice({ offer }: { offer: {
  priceCents: number | null
  originalPriceCents: number | null
  discountPercent: number
} }) {
  if (offer.priceCents === null) return null
  const discounted = offer.originalPriceCents !== null && offer.originalPriceCents > offer.priceCents
  return <span className="offer-price">
    <strong>{money(offer.priceCents)}</strong>
    {discounted && offer.originalPriceCents !== null && <>
      <del>{money(offer.originalPriceCents)}</del><span className="discount-tag">−{offer.discountPercent}%</span>
    </>}
  </span>
}
