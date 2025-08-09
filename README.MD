# ClipGen

[Platform](https://clipgen.jcc.lol)

[API](https://api.clipgen.jcc.lol)

[Docs](https://clipgen.jcc.lol/docs)

ClipGen is an AI video generation platform that provides users with access to the [Mochi](https://github.com/genmoai/mochi) text-to-video model through a comprehensive web interface and REST API. Mochi is an open-source text-to-video diffusion model developed by Genmo, featuring a Transformer-based diffusion architecture (DiT) with T5 text encoding and VAE video decoding capabilities. The platform offers users an interactive playground for video generation, APIs, API documentation, real-time job queue monitoring with WebSocket updates, API key management, and request retention. Users can generate short video clips from text prompts through either the web interface or programmatic API access with authentication and rate limiting. The system scales to an arbitrary number of user requests and to an arbitrary number of nodes provisioned in the Kubernetes cluster.