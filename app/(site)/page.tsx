import Link from 'next/link';
import { InstagramIcon } from '@/components/icons';

export default function Home() {
  return (
    <>
      <section className="cover">
        <h2>Welcome to Cyanotypes by Chloé!</h2>
        <p>This website is still a work in progress.<br />Please check out my social media!</p>
        <p>
          <a className="social-link button-link" href="https://www.instagram.com/cyanotypes.by.chloe">
            <InstagramIcon title="Instagram logo" />
            <span>@cyanotypes.by.chloe</span>
          </a>
        </p>
      </section>
      <section className="tools">
        <h2>Tools</h2>
        <p>
          <b>Negative Studio</b> turns your photos into corrected digital negatives for cyanotype printing, and
          calibrates them to your paper, chemistry and light. Sign in with GitHub to keep your profiles and curves
          in the cloud.
        </p>
        <p>
          <Link className="button-link" href="/tools/negative-studio">Open Negative Studio</Link>
        </p>
      </section>
    </>
  );
}
