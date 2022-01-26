import * as React from "react"
import { graphql, Link } from "gatsby"
import Layout from "../../components/layout.js"
import {GatsbyImage, getImage} from "gatsby-plugin-image";

function BlogPost({ data }) {
    const post = data.markdownRemark
    const frontmatter = post.frontmatter
    const image = getImage(frontmatter.thumbnail)

    return (
        <Layout>
            <div className="wrapper">
                <header>
                    <Link to="/blog">Blog</Link>
                </header>
                <main>
                    <GatsbyImage alt={frontmatter.title} image={image} />
                    <h1>{frontmatter.title}</h1>
                    <p>{frontmatter.description}</p>
                    <em>{frontmatter.date}</em>}
                    <div dangerouslySetInnerHTML={{ __html: post.html }} />
                </main>
            </div>
        </Layout>
    )
}

export default BlogPost

export const query = graphql`
  query($id: String!) {
    markdownRemark(id: {eq: $id}) {
      frontmatter {
        date
        title
        description
        thumbnail {
          childImageSharp {
            gatsbyImageData(placeholder: BLURRED)
          }
        }
      }
      html
    }
  }
`