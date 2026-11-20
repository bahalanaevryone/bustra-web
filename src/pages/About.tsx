import { BusFront, MapPin, ShieldCheck, Radio } from 'lucide-react'
import { Link } from 'react-router-dom'
export function About() {
  return (
    <div className="container page-space about-page">
      <span className="eyebrow">A BETTER WAY TO GET THERE</span>
      <h1>
        Less waiting.
        <br />
        <span className="blue-text">More knowing.</span>
      </h1>
      <p className="lead">
        BUSTRA is a web-based bus tracking and passenger pickup request system for Mamburao,
        Occidental Mindoro. It connects passengers and transport staff through clearer information.
      </p>
      <div className="about-grid">
        <article className="card">
          <MapPin />
          <h2>Open to everyone</h2>
          <p>
            Browse the map, routes, and schedules without creating an account. Register when you’re
            ready to choose a pickup pin and request driver review.
          </p>
        </article>
        <article className="card">
          <BusFront />
          <h2>Built around the journey</h2>
          <p>
            Assigned employees share their bus location and update a numeric passenger count.
            Requests help them know where someone is waiting; they don’t reserve seats.
          </p>
        </article>
        <article className="card">
          <ShieldCheck />
          <h2>Respect for your privacy</h2>
          <p>
            Only bus locations are published. Your own location stays in your browser when you
            choose Locate me. Other passengers’ device positions are never shown.
          </p>
        </article>
        <article className="card">
          <Radio />
          <h2>Honest about live data</h2>
          <p>
            Tracking requires the assigned employee’s page to stay active with GPS permission.
            Background tracking is not guaranteed. Outdated locations are clearly marked.
          </p>
        </article>
      </div>
      <section className="card about-note">
        <h2>A student capstone, built with care.</h2>
        <p>
          BUSTRA is a BSIT project. Demo stops, buses, and departures are illustrative and do not
          represent an official operator or service.
        </p>
        <p>
          <strong>ETA and AI:</strong> The basic estimator requires actual road distance and a valid
          speed assumption. Without these, ETA is unavailable. The optional AI arrival model is
          planned / not trained; historical arrivals and evaluation data have not been collected.
        </p>
        <Link className="button button-primary" to="/map">
          Explore the map
        </Link>
      </section>
    </div>
  )
}
