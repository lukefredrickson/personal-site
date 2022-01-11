module.exports = {
  siteMetadata: {
    title: `Luke Fredrickson`,
    description: `An aspiring software developer studying CS at UVM.`,
    author: `@lukefredrickson`,
    siteUrl: `https://lukefredrickson.netlify.app`,
  },
  plugins: [
    {
      resolve: `gatsby-source-filesystem`,
      options: {
        name: `images`,
        path: `${__dirname}/src/images`,
      },
    },
    `gatsby-plugin-image`,
    `gatsby-plugin-sharp`,
    `gatsby-transformer-sharp`,
    `gatsby-plugin-react-helmet`,
    `gatsby-plugin-netlify-cms`,
    `gatsby-plugin-postcss`,
  ],
}
