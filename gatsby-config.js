module.exports = {
  siteMetadata: {
    title: `Luke Fredrickson`,
    description: `An aspiring software developer studying CS at UVM.`,
    author: `@lukefredrickson`,
    siteUrl: `https://lukefredrickson.netlify.app`,
  },
  plugins: [
    `gatsby-plugin-postcss`,
    `gatsby-plugin-react-helmet`,
    `gatsby-plugin-image`,
    {
      resolve: `gatsby-source-filesystem`,
      options: {
        name: `images`,
        path: `${__dirname}/src/images`,
      },
    },
    `gatsby-transformer-sharp`,
    `gatsby-plugin-sharp`,
  ],
}
