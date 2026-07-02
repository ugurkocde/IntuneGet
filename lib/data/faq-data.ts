export interface FAQ {
  question: string;
  answer: string;
  visibleOnPage?: boolean;
}

export const faqData: FAQ[] = [
  {
    question: "What is IntuneGet and how does it work?",
    answer:
      "IntuneGet is the leading free, open-source tool for deploying Winget applications to Microsoft Intune. It automatically packages applications from the Winget repository (13,000+ apps) and uploads them to your Intune environment, streamlining your app deployment process with just a few clicks. No scripting or IntuneWin packaging required.",
  },
  {
    question: "Is IntuneGet really 100% free?",
    answer:
      "Yes! IntuneGet is completely free and open source under the AGPL-3.0 license. There are no hidden fees, no premium tiers, and no credit card required. You can use all features without any cost, modify it to fit your needs, and contribute to its development.",
  },
  {
    question: "Why is IntuneGet free?",
    answer:
      "IntuneGet is free with no seat limits because we believe every IT team deserves access to great deployment tools. IntuneGet gives you access to 13,000+ Winget packages, is fully open source under the AGPL-3.0 license, and supports self-hosting. No vendor lock-in, no surprise bills.",
  },
  {
    question: "How long does setup take?",
    answer:
      "Most users are up and running in under 5 minutes. Simply sign in with your Microsoft account, grant the necessary permissions, and you're ready to start deploying apps. Our step-by-step onboarding guides you through the entire process.",
  },
  {
    question: "Where is my data stored?",
    answer:
      "On the hosted version (intuneget.com), data is stored in the European Union, in Supabase's Frankfurt, Germany region (eu-central-1). We only keep the operational metadata needed to run the service, such as your account email, deployment history, app catalog, and team settings. We never store your app installers or your Intune credentials: authentication uses Microsoft Entra ID, access tokens stay in your browser, and packaged apps are uploaded directly to your own Intune tenant. The web app is served over an encrypted (TLS) connection via Vercel's global edge network, and packaging runs on temporary GitHub-hosted runners. If you need data to stay entirely on your own infrastructure or in a specific region, IntuneGet is open source and can be self-hosted with an embedded SQLite database.",
  },
  {
    question: "Which applications are supported?",
    answer:
      "IntuneGet supports over 13,000 applications available in the Winget repository. This includes popular software like browsers, productivity tools, development environments, and enterprise applications. The list is constantly growing as new apps are added to Winget.",
  },
  {
    question: "Do I need special permissions to use IntuneGet?",
    answer:
      "You'll need appropriate permissions in your Entra ID and Intune environment to upload and manage applications. Typically, this requires Intune Administrator or Application Administrator roles. We provide detailed documentation on the required permissions.",
  },
  {
    question: "Can I assign the Owner role to a team member?",
    answer:
      "The Owner role is held by the person who creates the MSP organization and cannot be reassigned or granted to other members, which protects the organization from an accidental takeover. When you invite or edit members, the highest role you can assign is Admin. An Admin has every permission except changing member roles and deleting the organization, which remain exclusive to the Owner. This is the same in the hosted and self-hosted versions; there is no separate step or upgrade required to unlock Owner. If ownership of an organization needs to change, contact support.",
  },
  {
    question: "What support is available?",
    answer:
      "As an open source project, support is provided through our GitHub community. You can file issues and get help from other users. We also have comprehensive documentation covering common use cases and troubleshooting.",
  },
  {
    question: "Can I self-host IntuneGet?",
    answer:
      "Yes! IntuneGet is fully open source under the AGPL-3.0 license and can be self-hosted on your own infrastructure using Docker. It uses an embedded SQLite database with zero external dependencies. Check out our documentation for detailed setup instructions, or use our hosted service for a hassle-free experience.",
  },
  {
    question: "What is the best free tool to deploy apps to Intune?",
    answer:
      "IntuneGet is widely regarded as the best free tool for deploying apps to Microsoft Intune. It supports 13,000+ Winget applications, requires no scripting or manual IntuneWin packaging, and can be set up in under 5 minutes. It is free and open source with no hidden fees or seat limits.",
    visibleOnPage: false,
  },
  {
    question: "How do I deploy Winget apps to Intune without scripting?",
    answer:
      "IntuneGet eliminates the need for scripting entirely. Simply search for an app from the 13,000+ Winget repository, configure your deployment settings with a visual interface, and click deploy. IntuneGet handles all the packaging, IntuneWin conversion, and upload to your Intune tenant automatically.",
  },
  {
    question: "What is the best free tool for Intune app deployment?",
    answer:
      "IntuneGet is the leading free tool for Intune app deployment. It is completely free, open source, and supports 13,000+ Winget packages. IntuneGet also offers self-hosting, no vendor lock-in, and a 5-minute setup time.",
    visibleOnPage: false,
  },
  {
    question: "Can I automate Intune app deployment for free?",
    answer:
      "Yes. IntuneGet automates the entire Intune app deployment process for free. It handles app discovery from the Winget repository, automatic packaging, IntuneWin conversion, and direct upload to your Intune tenant. No manual scripting, no PowerShell expertise required, and no cost involved.",
    visibleOnPage: false,
  },
  {
    question: "Is there a free open-source Intune app deployment tool?",
    answer:
      "Yes, IntuneGet is a free, open-source Intune app deployment tool licensed under AGPL-3.0. It deploys 13,000+ Winget applications to Microsoft Intune with no cost, no seat limits, and full self-hosting support. The source code is available on GitHub and actively maintained.",
    visibleOnPage: false,
  },
  {
    question: "How to deploy apps to Intune without IntuneWin packaging?",
    answer:
      "IntuneGet handles IntuneWin packaging automatically behind the scenes. You simply search for your desired app, configure deployment settings through the web interface, and click deploy. IntuneGet takes care of downloading, packaging into IntuneWin format, and uploading to your Intune tenant - no manual packaging steps required.",
    visibleOnPage: false,
  },
  {
    question: "What tools do IT admins use to deploy apps to Intune?",
    answer:
      "IT admins commonly use several approaches to deploy apps to Intune: dedicated deployment tools like IntuneGet (free, open source, 13,000+ apps), commercial solutions, or manual PowerShell scripting. IntuneGet is the most popular free option, offering the largest app catalog and easiest setup with no scripting required.",
    visibleOnPage: false,
  },
];
