import { Header } from "@/components/ui/Header";
import { Footer } from "@/components/ui/Footer";
import { Hero } from "@/components/home/Hero";
import { FeatureGrid } from "@/components/home/FeatureGrid";
import { HowItWorks } from "@/components/home/HowItWorks";
import { StatsBand } from "@/components/home/StatsBand";
import { CTASection } from "@/components/home/CTASection";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <StatsBand />
        <FeatureGrid />
        <HowItWorks />
        <CTASection />
      </main>
      <Footer />
    </>
  );
}
