import { Link } from 'react-router-dom'

const repository = 'https://github.com/Askirka/Eneba'

export function Footer() {
  return <footer className="site-footer">
    <div className="footer-inner">
      <div className="footer-intro">
        <Link className="brand" to="/">Game Market</Link>
        <span>Educational marketplace demo</span>
        <div className="footer-social" aria-label="Community channels">
          <a href={repository} aria-label="Game Market on GitHub">GH</a>
          <a href={repository + '/issues'} aria-label="GitHub issue tracker">💬</a>
        </div>
      </div>
      <div className="footer-columns">
        <nav aria-label="About">
          <h2>About</h2>
          <a href={repository + '#scope-and-decisions'}>About the project</a>
          <a href={repository}>Source code</a>
        </nav>
        <nav aria-label="Buy">
          <h2>Buy</h2>
          <Link to="/store">Browse games</Link>
          <Link to="/store?deals=1">Deals</Link>
          <Link to="/wishlist">Wishlist</Link>
        </nav>
        <nav aria-label="Help">
          <h2>Help</h2>
          <a href={repository + '#cart-and-demo-purchases'}>Buying and activation</a>
          <Link to="/account#history">Purchase history</Link>
        </nav>
        <nav aria-label="Community">
          <h2>Community</h2>
          <a href={repository + '/issues'}>Report an issue</a>
          <a href={repository + '/pulls'}>Contribute</a>
        </nav>
        <nav aria-label="Business">
          <h2>Business</h2>
          <Link to="/account#listings">Sell a game</Link>
          <Link to="/account">Seller account</Link>
        </nav>
      </div>
      <div className="footer-bottom">
        <div className="footer-payments" aria-label="Illustrated payment methods for demo checkout">
          <span>Demo checkout</span>
          <span className="payment-badge payment-visa">VISA</span>
          <span className="payment-badge payment-mastercard">Mastercard</span>
          <span className="payment-badge payment-paypal">PayPal</span>
        </div>
        <span>Language: English · Currency: EUR</span>
      </div>
    </div>
  </footer>
}
