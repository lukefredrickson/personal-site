import * as React from "react"
import { graphql, Link } from "gatsby"
import { GatsbyImage, getImage } from "gatsby-plugin-image"
import Layout from "../../components/layout.js"

function Blog({ data }) {
    const posts = data.allMarkdownRemark.edges.map((edge) => (edge.node))
    return (
        <Layout>
            <div className="wrapper">
                {
                    posts.map((post) => {
                        const frontmatter = post.frontmatter
                        const image = getImage(frontmatter.thumbnail)
                        return (
                            <article key={post.id}>
                                <Link to={`/blog/${post.parent.name}`}>
                                    <GatsbyImage alt={frontmatter.title} image={image} />
                                </Link>
                                <Link to={`/blog/${post.parent.name}`}>
                                    <h2>
                                        {frontmatter.title}
                                    </h2>
                                </Link>
                                <p>Posted: {frontmatter.date}</p>
                                <p>{frontmatter.description}</p>
                            </article>
                    )})
                }
            </div>
        </Layout>
    )
}

export default Blog

export const query = graphql`
query AllBlogPosts {
  allMarkdownRemark(sort: {fields: frontmatter___date, order: DESC}) {
    edges {
      node {
        parent {
          ... on File {
            id
            name
          }
        }
        frontmatter {
          title
          thumbnail {
            childImageSharp {
              gatsbyImageData(placeholder: BLURRED)
            }
          }
          description
          date(formatString: "DD MMM, YYYY | h:mma")
        }
      }
    }
  }
}
`